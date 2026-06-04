"use client";

/**
 * curriculate.net/subs — Substitute Teacher Staffing
 *
 * Schools rank preferred substitutes per grade level and post sub requests;
 * the backend escalation engine contacts subs in order until one accepts.
 *
 * Auth: passwordless email-PIN (6-digit code → HMAC session in an HttpOnly
 * subs_session cookie). One signed-in email can be a school admin, a
 * substitute teacher, or both — the dashboard shows whichever roles apply.
 *
 * Backend API (api.curriculate.net):
 *   /api/subs-auth/*     — request-pin, verify-pin, logout, me
 *   /api/subs-admin/*    — schools, grades, teachers, rankings, requests
 *   /api/subs-teacher/*  — profile, offers, accept/decline
 *
 * The cookie is the real credential (sent via credentials:"include");
 * localStorage holds only the email as a "we were signed in" hint.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

const AUTH_KEY = "subs.auth.v1";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ── tiny UI helpers ───────────────────────────────────────────────────
const C = {
  page: { minHeight: "100vh", background: "#f8fafc", color: "#0f172a", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif" },
  wrap: { maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 16 },
  h1: { fontSize: 24, fontWeight: 800, margin: "0 0 4px" },
  h2: { fontSize: 17, fontWeight: 700, margin: "0 0 12px" },
  sub: { color: "#64748b", margin: "0 0 20px" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#475569", margin: "10px 0 4px" },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 15 },
  btn: { background: "#2563eb", color: "#fff", border: 0, padding: "9px 16px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnGhost: { background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "8px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnGreen: { background: "#16a34a", color: "#fff", border: 0, padding: "8px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnRed: { background: "#fff", color: "#dc2626", border: "1px solid #fecaca", padding: "8px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  err: { background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "10px 12px", borderRadius: 8, margin: "8px 0", fontSize: 14 },
  pill: (bg, fg) => ({ background: bg, color: fg, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, display: "inline-block" }),
};

function StatusPill({ status }) {
  const map = {
    open: ["#dbeafe", "#1d4ed8"],
    pending: ["#fef9c3", "#a16207"],
    filled: ["#dcfce7", "#15803d"],
    accepted: ["#dcfce7", "#15803d"],
    exhausted: ["#fee2e2", "#b91c1c"],
    declined: ["#fee2e2", "#b91c1c"],
    expired: ["#f1f5f9", "#64748b"],
    cancelled: ["#f1f5f9", "#64748b"],
  };
  const [bg, fg] = map[status] || ["#f1f5f9", "#64748b"];
  return <span style={C.pill(bg, fg)}>{status}</span>;
}

function timeLeft(expiresAt) {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m left`;
  return `${Math.round(m / 60)}h left`;
}

// Countdown to the bell ("time-to-bell" on the morning dashboard).
function untilBell(needBy, nowTs) {
  if (!needBy) return { text: "", urgent: false };
  const ms = new Date(needBy).getTime() - nowTs;
  const past = ms < 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const text = (past ? "-" : "") + (h > 0 ? `${h}h ${m}m` : `${m}m`);
  return { text: past ? `${text} (past bell)` : `${text} to bell`, urgent: ms < 60 * 60000 };
}

// ─────────────────────────────────────────────────────────────────────
export default function SubsPage() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("admin"); // 'admin' | 'teacher'

  const refreshMe = useCallback(async () => {
    try {
      const data = await api("/api/subs-auth/me");
      setMe(data);
      // Substitutes who aren't admins land on the teacher view; everyone
      // else (admins, and brand-new users who'll create a school) on admin.
      setView(data.isTeacher && !data.isAdmin ? "teacher" : "admin");
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const [invite, setInvite] = useState(null);
  const [inviteMsg, setInviteMsg] = useState("");

  useEffect(() => {
    // Capture an invite token from the registration link (?invite=…).
    try {
      const tk = new URLSearchParams(window.location.search).get("invite");
      if (tk) setInvite(tk);
    } catch {}
    let hint = null;
    try {
      hint = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    } catch {}
    if (hint?.email) refreshMe();
    else setLoading(false);
  }, [refreshMe]);

  // Once signed in, redeem any pending invite so the school is attached and
  // the sub lands on their (multi-school) substitute view.
  useEffect(() => {
    if (!me || !invite) return;
    (async () => {
      try {
        const r = await api("/api/subs-teacher/accept-invite", { method: "POST", body: { token: invite } });
        setInviteMsg(`You're registered with ${r.schools?.length || 0} school(s).`);
        setInvite(null);
        setView("teacher");
        refreshMe();
      } catch {
        setInvite(null);
      }
    })();
  }, [me, invite, refreshMe]);

  async function signOut() {
    await api("/api/subs-auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem(AUTH_KEY);
    setMe(null);
  }

  if (loading) {
    return (
      <div style={C.page}>
        <div style={C.wrap}>Loading…</div>
      </div>
    );
  }

  if (!me) {
    return (
      <div style={C.page}>
        <div style={{ ...C.wrap, maxWidth: 440 }}>
          <h1 style={C.h1}>Curriculate Subs</h1>
          <p style={C.sub}>
            Finding a substitute is the most stressful part of a principal's morning. We do the calling — matching the right people,
            in your order — until the class is covered.
          </p>
          {invite && (
            <div style={{ ...C.err, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
              You've been invited to join a school as a substitute — sign in to accept.
            </div>
          )}
          <SignIn onSignedIn={refreshMe} />
          <div style={{ ...C.row, marginTop: 14 }}>
            <a href="/subs/features" style={{ ...C.btnGhost, textDecoration: "none", display: "inline-block" }}>
              ✨ See features
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Always offer both roles — anyone can post requests as a school admin
  // (create a school) or act as a substitute.
  const showSwitch = true;
  return (
    <div style={C.page}>
      <div style={C.wrap}>
        <div style={{ ...C.row, justifyContent: "space-between", marginBottom: 18 }}>
          <h1 style={{ ...C.h1, marginBottom: 0 }}>Curriculate Subs</h1>
          <div style={C.row}>
            <a href="/subs/features" style={{ color: "#64748b", fontSize: 13, textDecoration: "none" }}>
              Features
            </a>
            <span style={{ color: "#64748b", fontSize: 13 }}>{me.email}</span>
            <button style={C.btnGhost} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {inviteMsg && <div style={{ ...C.err, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#15803d" }}>{inviteMsg}</div>}

        {showSwitch && (
          <div style={{ ...C.row, marginBottom: 16 }}>
            <button style={view === "admin" ? C.btn : C.btnGhost} onClick={() => setView("admin")}>
              School admin
            </button>
            <button style={view === "teacher" ? C.btn : C.btnGhost} onClick={() => setView("teacher")}>
              Substitute
            </button>
          </div>
        )}

        {view === "admin" && <AdminDashboard />}
        {view === "teacher" && <TeacherDashboard />}
      </div>
    </div>
  );
}

// ── Sign-in (email → PIN) ─────────────────────────────────────────────
function SignIn({ onSignedIn }) {
  const [stage, setStage] = useState("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [devPin, setDevPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestPin(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api("/api/subs-auth/request-pin", { method: "POST", body: { email } });
      setDevPin(r.devPin || "");
      setStage("pin");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPin(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/api/subs-auth/verify-pin", { method: "POST", body: { email, pin } });
      localStorage.setItem(AUTH_KEY, JSON.stringify({ email }));
      onSignedIn();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={C.card}>
      {err && <div style={C.err}>{err}</div>}
      {stage === "email" ? (
        <form onSubmit={requestPin}>
          <label style={C.label}>Email</label>
          <input style={C.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.org" required />
          <div style={{ marginTop: 14 }}>
            <button style={C.btn} disabled={busy}>
              {busy ? "Sending…" : "Send sign-in code"}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={verifyPin}>
          <p style={{ color: "#475569", marginTop: 0 }}>We sent a 6-digit code to {email}.</p>
          {devPin && (
            <div style={{ ...C.err, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
              Dev mode (no email provider): your code is <strong>{devPin}</strong>
            </div>
          )}
          <label style={C.label}>6-digit code</label>
          <input style={C.input} inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" required />
          <div style={{ ...C.row, marginTop: 14 }}>
            <button style={C.btn} disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button type="button" style={C.btnGhost} onClick={() => setStage("email")}>
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Morning triage dashboard (the 5–7 a.m. view) ──────────────────────
function MorningDashboard() {
  const [data, setData] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api("/api/subs-admin/dashboard"));
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    const c = setInterval(() => setNowTs(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  if (!data) return null;
  const { open = [], coveredToday = [], burnout = [] } = data;

  return (
    <div style={{ ...C.card, borderColor: "#bfdbfe", background: "#f8fbff" }}>
      <div style={{ ...C.row, justifyContent: "space-between" }}>
        <h2 style={{ ...C.h2, marginBottom: 0 }}>🌅 This morning — {open.length} open</h2>
        <button style={C.btnGhost} onClick={load}>
          Refresh
        </button>
      </div>

      {open.length === 0 && <p style={{ color: "#64748b", marginTop: 12 }}>No open absences right now. 🎉</p>}

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {open.map((r) => {
          const bell = untilBell(r.needBy, nowTs);
          const zero = r.eligibleCount === 0;
          return (
            <div
              key={r._id}
              style={{
                border: `1px solid ${zero ? "#fecaca" : "#e2e8f0"}`,
                background: zero ? "#fff5f5" : "#fff",
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span style={C.pill(r.urgency === "urgent" ? "#fee2e2" : "#e0e7ff", r.urgency === "urgent" ? "#b91c1c" : "#3730a3")}>
                {r.urgency === "urgent" ? "URGENT" : "advance"}
              </span>
              <strong>{r.schoolAbbrev || r.schoolName}</strong>
              <span>{r.gradeName}</span>
              {r.requiredRole && r.requiredRole !== "teacher" && <span style={C.pill("#f1f5f9", "#334155")}>{r.requiredRole}</span>}
              <span style={{ color: bell.urgent ? "#b91c1c" : "#64748b", fontWeight: bell.urgent ? 700 : 400, fontSize: 13 }}>⏰ {bell.text}</span>
              {zero ? (
                <span style={C.pill("#fee2e2", "#b91c1c")}>⚠ 0 qualified candidates</span>
              ) : (
                <span style={{ color: "#64748b", fontSize: 13 }}>{r.eligibleCount} qualified</span>
              )}
              {r.pendingOfferExpiresAt && <span style={{ color: "#a16207", fontSize: 13 }}>contacting — {timeLeft(r.pendingOfferExpiresAt)}</span>}
              {r.status === "exhausted" && <span style={C.pill("#fee2e2", "#b91c1c")}>needs coverage</span>}
            </div>
          );
        })}
      </div>

      {coveredToday.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#15803d" }}>✓ Covered today</div>
          {coveredToday.map((c) => (
            <div key={c._id} style={{ fontSize: 13, color: "#475569" }}>
              {c.schoolName} · {c.gradeName} — {c.coverageType === "internal" ? "internal coverage" : "substitute confirmed"}
            </div>
          ))}
        </div>
      )}

      {burnout.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#92400e" }}>Internal-coverage load (watch for burnout)</div>
          <div style={C.row}>
            {burnout.slice(0, 8).map((b) => (
              <span key={b.staffName} style={C.pill(b.count >= 3 ? "#fef3c7" : "#f1f5f9", b.count >= 3 ? "#92400e" : "#334155")}>
                {b.staffName}: {b.count}×
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Approvals queue (teacher-submitted absence requests) ──────────────
function ApprovalRow({ a, onDone }) {
  const [role, setRole] = useState("teacher");
  const [quals, setQuals] = useState("");
  const [urgency, setUrgency] = useState(a.urgency || "urgent");
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/subs-admin/requests/${a._id}/approve`, {
        method: "POST",
        body: { requiredRole: role, requiredQualifications: quals.split(",").map((q) => q.trim()).filter(Boolean), urgency },
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  async function deny() {
    setBusy(true);
    try {
      await api(`/api/subs-admin/requests/${a._id}/deny`, { method: "POST", body: { denyReason } });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div style={C.row}>
        <strong>{a.absentTeacher?.name || a.absentTeacher?.email || "A teacher"}</strong>
        <span>needs a sub for</span>
        <strong>{a.gradeName}</strong>
        <span style={{ color: "#64748b" }}>
          {a.schoolName} · {a.date}
        </span>
        <span style={C.pill(a.urgency === "urgent" ? "#fee2e2" : "#e0e7ff", a.urgency === "urgent" ? "#b91c1c" : "#3730a3")}>{a.urgency}</span>
        {a.reason && <span style={C.pill("#f1f5f9", "#334155")}>{a.reason}</span>}
      </div>
      {a.notes && <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{a.notes}</div>}
      <div style={{ ...C.row, marginTop: 10 }}>
        <select style={{ ...C.input, width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="teacher">Teacher</option>
          <option value="ea">EA</option>
          <option value="specialist">Specialist</option>
          <option value="tech">Tech</option>
        </select>
        <input style={{ ...C.input, width: 200 }} placeholder="Required qualifications" value={quals} onChange={(e) => setQuals(e.target.value)} />
        <select style={{ ...C.input, width: 110 }} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          <option value="urgent">Urgent</option>
          <option value="advance">Advance</option>
        </select>
        <button style={C.btnGreen} onClick={approve} disabled={busy}>
          Approve → start contacting
        </button>
        <button style={C.btnRed} onClick={() => setDenyOpen((d) => !d)} disabled={busy}>
          Deny
        </button>
      </div>
      {denyOpen && (
        <div style={{ ...C.row, marginTop: 8 }}>
          <input style={{ ...C.input, width: 240 }} placeholder="Reason (optional)" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} />
          <button style={C.btnRed} onClick={deny} disabled={busy}>
            Confirm deny
          </button>
        </div>
      )}
    </div>
  );
}

function ApprovalsQueue() {
  const [approvals, setApprovals] = useState([]);
  const load = useCallback(async () => {
    try {
      const { approvals } = await api("/api/subs-admin/approvals");
      setApprovals(approvals);
    } catch {}
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (approvals.length === 0) return null;
  return (
    <div style={{ ...C.card, borderColor: "#fde68a" }}>
      <h2 style={C.h2}>🛎️ Approvals needed ({approvals.length})</h2>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: -6 }}>Teachers reported absences. Approve to start contacting subs.</p>
      {approvals.map((a) => (
        <ApprovalRow key={a._id} a={a} onDone={load} />
      ))}
    </div>
  );
}

// ── Admin dashboard ───────────────────────────────────────────────────
function AdminDashboard() {
  const [schools, setSchools] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [err, setErr] = useState("");

  const loadSchools = useCallback(async () => {
    try {
      const { schools } = await api("/api/subs-admin/schools");
      setSchools(schools);
      setActiveId((cur) => cur || schools[0]?._id || null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    loadSchools();
  }, [loadSchools]);

  const active = schools.find((s) => s._id === activeId) || null;

  return (
    <div>
      {err && <div style={C.err}>{err}</div>}
      <MorningDashboard />
      <ApprovalsQueue />
      <div style={C.card}>
        <h2 style={C.h2}>Schools</h2>
        <div style={C.row}>
          {schools.map((s) => (
            <button key={s._id} style={s._id === activeId ? C.btn : C.btnGhost} onClick={() => setActiveId(s._id)}>
              {s.name}
            </button>
          ))}
        </div>
        <CreateSchool onCreated={loadSchools} />
      </div>

      {active && <SchoolPanel school={active} />}
    </div>
  );
}

function CreateSchool({ onCreated }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      style={{ ...C.row, marginTop: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await api("/api/subs-admin/schools", { method: "POST", body: { name, location } });
          setName("");
          setLocation("");
          onCreated();
        } finally {
          setBusy(false);
        }
      }}
    >
      <input style={{ ...C.input, width: 200 }} placeholder="New school name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={{ ...C.input, width: 180 }} placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
      <button style={C.btn} disabled={busy}>
        Add school
      </button>
    </form>
  );
}

function SchoolPanel({ school }) {
  const [grades, setGrades] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [err, setErr] = useState("");

  const loadGrades = useCallback(async () => {
    const { grades } = await api(`/api/subs-admin/schools/${school._id}/grades`);
    setGrades(grades);
  }, [school._id]);
  const loadTeachers = useCallback(async () => {
    const { teachers } = await api("/api/subs-admin/teachers");
    setTeachers(teachers);
  }, []);

  useEffect(() => {
    Promise.all([loadGrades(), loadTeachers()]).catch((e) => setErr(e.message));
  }, [loadGrades, loadTeachers]);

  return (
    <div>
      {err && <div style={C.err}>{err}</div>}

      <SchoolSettings school={school} onSaved={() => window.location.reload()} />

      <div style={C.card}>
        <h2 style={C.h2}>Grade levels</h2>
        {grades.length === 0 && <span style={{ color: "#94a3b8" }}>No grade levels yet.</span>}
        {grades.map((g) => (
          <GradeVpRow key={g._id} school={school} grade={g} />
        ))}
        <InlineAdd
          placeholder="e.g. Grade 3"
          label="Add grade level"
          onAdd={async (name) => {
            await api(`/api/subs-admin/schools/${school._id}/grades`, { method: "POST", body: { name } });
            loadGrades();
          }}
        />
      </div>

      <div style={C.card}>
        <h2 style={C.h2}>Substitute pool</h2>
        <div style={{ display: "grid", gap: 6 }}>
          {teachers.map((t) => (
            <div key={t._id} style={C.row}>
              <span style={{ fontWeight: 600 }}>{t.name || "(no name)"}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>{t.email}</span>
              {t.active === false && <span style={C.pill("#fee2e2", "#b91c1c")}>inactive</span>}
            </div>
          ))}
          {teachers.length === 0 && <span style={{ color: "#94a3b8" }}>No substitutes added yet.</span>}
        </div>
        <AddTeacher onAdded={loadTeachers} />
        <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 12, paddingTop: 8 }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>Invite a sub to register with this school (they get a sign-in link):</span>
          <InviteSub school={school} />
        </div>
      </div>

      {grades.map((g) => (
        <RankingEditor key={g._id} school={school} grade={g} teachers={teachers} />
      ))}

      <PostRequest school={school} grades={grades} />
      <RequestsBoard school={school} />
    </div>
  );
}

function InlineAdd({ placeholder, label, onAdd }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      style={{ ...C.row, marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!val.trim()) return;
        setBusy(true);
        try {
          await onAdd(val.trim());
          setVal("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input style={{ ...C.input, width: 220 }} placeholder={placeholder} value={val} onChange={(e) => setVal(e.target.value)} />
      <button style={C.btnGhost} disabled={busy}>
        {label}
      </button>
    </form>
  );
}

function AddTeacher({ onAdded }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      style={{ ...C.row, marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setBusy(true);
        try {
          await api("/api/subs-admin/teachers", { method: "POST", body: { email, name, phone } });
          setEmail("");
          setName("");
          setPhone("");
          onAdded();
        } finally {
          setBusy(false);
        }
      }}
    >
      <input style={{ ...C.input, width: 160 }} placeholder="sub@email.org" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={{ ...C.input, width: 130 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={{ ...C.input, width: 120 }} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button style={C.btnGhost} disabled={busy}>
        Add substitute
      </button>
    </form>
  );
}

function SchoolSettings({ school, onSaved }) {
  const [open, setOpen] = useState(false);
  const [abbrev, setAbbrev] = useState(school.abbrev || "");
  const [bellTime, setBellTime] = useState(school.bellTime || "08:30");
  const [faith, setFaith] = useState(!!school.faithFit?.enabled);
  const [budget, setBudget] = useState(school.subBudget?.total ?? "");
  const [vpEmail, setVpEmail] = useState(school.vpEmail || "");
  const [financeEmail, setFinanceEmail] = useState(school.financeEmail || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/subs-admin/schools/${school._id}`, {
        method: "PATCH",
        body: { abbrev, bellTime, faithFitEnabled: faith, subBudgetTotal: budget === "" ? undefined : Number(budget), vpEmail, financeEmail },
      });
      onSaved();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={C.card}>
      <div style={{ ...C.row, justifyContent: "space-between" }}>
        <h2 style={{ ...C.h2, marginBottom: 0 }}>Settings — {school.name}</h2>
        <button style={C.btnGhost} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={C.row}>
            <div>
              <label style={C.label}>Abbreviation (SMS prefix)</label>
              <input style={{ ...C.input, width: 100 }} value={abbrev} onChange={(e) => setAbbrev(e.target.value)} placeholder="BCS" />
            </div>
            <div>
              <label style={C.label}>Default bell time</label>
              <input style={{ ...C.input, width: 110 }} type="time" value={bellTime} onChange={(e) => setBellTime(e.target.value)} />
            </div>
            <div>
              <label style={C.label}>Sub budget ($)</label>
              <input style={{ ...C.input, width: 120 }} type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div style={C.row}>
            <div>
              <label style={C.label}>Default VP email (lesson plans)</label>
              <input style={{ ...C.input, width: 220 }} value={vpEmail} onChange={(e) => setVpEmail(e.target.value)} placeholder="vp@school.org" />
            </div>
            <div>
              <label style={C.label}>Finance email</label>
              <input style={{ ...C.input, width: 220 }} value={financeEmail} onChange={(e) => setFinanceEmail(e.target.value)} placeholder="finance@school.org" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 0" }}>
            On a fill, the VP (or the grade's own VP) and finance are notified automatically — you're done. Set per-grade VPs under Grade levels.
          </p>
          <label style={{ ...C.row, marginTop: 10 }}>
            <input type="checkbox" checked={faith} onChange={(e) => setFaith(e.target.checked)} /> Enable mission / faith-fit attributes
          </label>
          <div style={{ marginTop: 12 }}>
            <button style={C.btn} onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GradeVpRow({ school, grade }) {
  const [vp, setVp] = useState(grade.vpEmail || "");
  const [saved, setSaved] = useState(false);
  async function save() {
    await api(`/api/subs-admin/schools/${school._id}/grades/${grade._id}`, { method: "PATCH", body: { vpEmail: vp } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }
  return (
    <div style={{ ...C.row, marginBottom: 4 }}>
      <span style={{ ...C.pill("#f1f5f9", "#334155"), minWidth: 90 }}>{grade.name}</span>
      <input style={{ ...C.input, width: 220 }} value={vp} placeholder="VP for this grade (optional)" onChange={(e) => setVp(e.target.value)} onBlur={save} />
      {saved && <span style={{ color: "#15803d", fontSize: 12 }}>saved</span>}
    </div>
  );
}

function InviteSub({ school }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      style={{ ...C.row, marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setBusy(true);
        try {
          const r = await api(`/api/subs-admin/schools/${school._id}/invite`, { method: "POST", body: { email, name, phone } });
          setLink(r.inviteLink);
          setEmail("");
          setName("");
          setPhone("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input style={{ ...C.input, width: 160 }} placeholder="sub@email.org" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={{ ...C.input, width: 120 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={{ ...C.input, width: 120 }} placeholder="Phone (SMS)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button style={C.btn} disabled={busy}>
        Invite to {school.abbrev || "school"}
      </button>
      {link && (
        <span style={{ fontSize: 12, color: "#15803d", width: "100%" }}>
          Invite sent. Link: <code>{link}</code>
        </span>
      )}
    </form>
  );
}

function RankingEditor({ school, grade, teachers }) {
  const [ranked, setRanked] = useState([]); // ordered teacherIds
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { teacherIds } = await api(`/api/subs-admin/schools/${school._id}/grades/${grade._id}/ranking`);
    setRanked(teacherIds.map(String));
  }, [school._id, grade._id]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const byId = useMemo(() => new Map(teachers.map((t) => [String(t._id), t])), [teachers]);
  const unranked = teachers.filter((t) => !ranked.includes(String(t._id)));

  async function save(next) {
    setRanked(next);
    setSaved(false);
    try {
      await api(`/api/subs-admin/schools/${school._id}/grades/${grade._id}/ranking`, { method: "PUT", body: { teacherIds: next } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr(e.message);
    }
  }

  function move(idx, dir) {
    const next = [...ranked];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    save(next);
  }

  return (
    <div style={C.card}>
      <div style={{ ...C.row, justifyContent: "space-between" }}>
        <h2 style={C.h2}>Preferred subs — {grade.name}</h2>
        {saved && <span style={C.pill("#dcfce7", "#15803d")}>saved</span>}
      </div>
      {err && <div style={C.err}>{err}</div>}
      <ol style={{ paddingLeft: 22, margin: "6px 0" }}>
        {ranked.map((id, idx) => {
          const t = byId.get(id);
          return (
            <li key={id} style={{ marginBottom: 6 }}>
              <span style={C.row}>
                <strong>{t?.name || t?.email || "Unknown"}</strong>
                <button style={C.btnGhost} onClick={() => move(idx, -1)} disabled={idx === 0}>
                  ↑
                </button>
                <button style={C.btnGhost} onClick={() => move(idx, 1)} disabled={idx === ranked.length - 1}>
                  ↓
                </button>
                <button style={C.btnRed} onClick={() => save(ranked.filter((x) => x !== id))}>
                  remove
                </button>
              </span>
            </li>
          );
        })}
        {ranked.length === 0 && <span style={{ color: "#94a3b8" }}>No ranking set — add subs below.</span>}
      </ol>
      {unranked.length > 0 && (
        <div style={{ ...C.row, marginTop: 8 }}>
          <span style={{ color: "#64748b", fontSize: 13 }}>Add:</span>
          {unranked.map((t) => (
            <button key={t._id} style={C.btnGhost} onClick={() => save([...ranked, String(t._id)])}>
              + {t.name || t.email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FAITH_OPTIONS = [
  ["statementOfFaith", "Aligns with statement of faith"],
  ["prayer", "Comfortable leading prayer/devotions"],
  ["christianEd", "Understands Christian education"],
  ["values", "Shares school values"],
];

function PostRequest({ school, grades }) {
  const today = new Date().toISOString().slice(0, 10);
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [urgency, setUrgency] = useState("urgent");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState(school.bellTime || "08:30");
  const [requiredRole, setRequiredRole] = useState("teacher");
  const [quals, setQuals] = useState(""); // comma-separated
  const [notes, setNotes] = useState("");
  const [difficultyNote, setDifficultyNote] = useState("");
  const [supportLevel, setSupportLevel] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [absentName, setAbsentName] = useState("");
  const [absentEmail, setAbsentEmail] = useState("");
  const [faith, setFaith] = useState({});
  const [showPlan, setShowPlan] = useState(false);
  const [plan, setPlan] = useState({ body: "", routineNotes: "", materials: "", credentials: [] });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gradeLevelId && grades[0]) setGradeLevelId(grades[0]._id);
  }, [grades, gradeLevelId]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const body = {
        schoolId: school._id,
        gradeLevelId,
        urgency,
        date,
        startTime,
        requiredRole,
        requiredQualifications: quals.split(",").map((q) => q.trim()).filter(Boolean),
        requiredFaithFit: Object.keys(faith).filter((k) => faith[k]),
        notes,
        difficultyNote,
        supportLevel,
        estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
        absentTeacher: absentEmail || absentName ? { name: absentName, email: absentEmail } : undefined,
      };
      const hasPlan = plan.body || plan.routineNotes || plan.materials || plan.credentials.length;
      if (hasPlan) {
        body.lessonPlan = {
          body: plan.body,
          routineNotes: plan.routineNotes,
          materialsLinks: plan.materials.split("\n").map((s) => s.trim()).filter(Boolean),
          credentials: plan.credentials.filter((c) => c.system || c.username || c.secret),
        };
      }
      const r = await api("/api/subs-admin/requests", { method: "POST", body });
      const n = r.eligibleCount;
      setMsg(n === 0 ? "⚠ Posted, but NO qualified subs match — consider widening requirements or internal coverage." : `Posted — contacting the first of ${n} qualified sub(s) now.`);
      setNotes("");
      setQuals("");
      setDifficultyNote("");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function setCred(i, field, val) {
    setPlan((p) => {
      const credentials = [...p.credentials];
      credentials[i] = { ...credentials[i], [field]: val };
      return { ...p, credentials };
    });
  }

  return (
    <div style={C.card}>
      <h2 style={C.h2}>Post a sub request</h2>
      {err && <div style={C.err}>{err}</div>}
      {msg && <div style={{ ...C.err, background: msg.startsWith("⚠") ? "#fffbeb" : "#ecfdf5", borderColor: msg.startsWith("⚠") ? "#fde68a" : "#a7f3d0", color: msg.startsWith("⚠") ? "#92400e" : "#15803d" }}>{msg}</div>}
      <form onSubmit={submit}>
        <div style={C.row}>
          <div>
            <label style={C.label}>Grade level</label>
            <select style={{ ...C.input, width: 150 }} value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
              {grades.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={C.label}>Role needed</label>
            <select style={{ ...C.input, width: 130 }} value={requiredRole} onChange={(e) => setRequiredRole(e.target.value)}>
              <option value="teacher">Teacher</option>
              <option value="ea">Educational assistant</option>
              <option value="specialist">Specialist</option>
              <option value="tech">Tech</option>
            </select>
          </div>
          <div>
            <label style={C.label}>Urgency</label>
            <select style={{ ...C.input, width: 200 }} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="urgent">Urgent — same day (5 min steps)</option>
              <option value="advance">Advance notice (4 hour steps)</option>
            </select>
          </div>
        </div>
        <div style={C.row}>
          <div>
            <label style={C.label}>Date needed</label>
            <input style={{ ...C.input, width: 150 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label style={C.label}>Start time</label>
            <input style={{ ...C.input, width: 110 }} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label style={C.label}>Day rate / est. cost ($)</label>
            <input style={{ ...C.input, width: 120 }} type="number" value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="e.g. 220" />
          </div>
        </div>

        <label style={C.label}>Required qualifications (comma-separated)</label>
        <input style={C.input} value={quals} onChange={(e) => setQuals(e.target.value)} placeholder="e.g. French, HS Math, Chemistry" />

        <div style={C.row}>
          <div>
            <label style={C.label}>Absent teacher (optional)</label>
            <input style={{ ...C.input, width: 160 }} value={absentName} onChange={(e) => setAbsentName(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <label style={C.label}>Their email (for lesson-plan reply-all)</label>
            <input style={{ ...C.input, width: 200 }} value={absentEmail} onChange={(e) => setAbsentEmail(e.target.value)} placeholder="teacher@school.org" />
          </div>
        </div>

        {school.faithFit?.enabled && (
          <>
            <label style={C.label}>Required mission / faith fit</label>
            <div style={C.row}>
              {FAITH_OPTIONS.map(([k, lbl]) => (
                <label key={k} style={C.row}>
                  <input type="checkbox" checked={!!faith[k]} onChange={(e) => setFaith((f) => ({ ...f, [k]: e.target.checked }))} /> {lbl}
                </label>
              ))}
            </div>
          </>
        )}

        <div style={C.row}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={C.label}>Notes</label>
            <input style={C.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Lesson plans on the desk" />
          </div>
        </div>
        <div style={C.row}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={C.label}>Difficulty note (private to admins)</label>
            <input style={C.input} value={difficultyNote} onChange={(e) => setDifficultyNote(e.target.value)} placeholder="e.g. Two students need extra support" />
          </div>
          <div>
            <label style={C.label}>Support available</label>
            <input style={{ ...C.input, width: 160 }} value={supportLevel} onChange={(e) => setSupportLevel(e.target.value)} placeholder="e.g. EA present" />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <button type="button" style={C.btnGhost} onClick={() => setShowPlan((s) => !s)}>
            {showPlan ? "− Hide lesson plan" : "+ Attach lesson plan"}
          </button>
        </div>
        {showPlan && (
          <div style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 12, marginTop: 10 }}>
            <label style={C.label}>Lesson / activities</label>
            <textarea style={{ ...C.input, minHeight: 70 }} value={plan.body} onChange={(e) => setPlan({ ...plan, body: e.target.value })} />
            <label style={C.label}>Classroom routine notes</label>
            <textarea style={{ ...C.input, minHeight: 50 }} value={plan.routineNotes} onChange={(e) => setPlan({ ...plan, routineNotes: e.target.value })} />
            <label style={C.label}>Materials links (one per line)</label>
            <textarea style={{ ...C.input, minHeight: 50 }} value={plan.materials} onChange={(e) => setPlan({ ...plan, materials: e.target.value })} />
            <label style={C.label}>System logins (encrypted at rest; shown only to the assigned sub)</label>
            {plan.credentials.map((c, i) => (
              <div key={i} style={{ ...C.row, marginBottom: 6 }}>
                <input style={{ ...C.input, width: 140 }} placeholder="System" value={c.system || ""} onChange={(e) => setCred(i, "system", e.target.value)} />
                <input style={{ ...C.input, width: 140 }} placeholder="Username" value={c.username || ""} onChange={(e) => setCred(i, "username", e.target.value)} />
                <input style={{ ...C.input, width: 140 }} type="password" placeholder="Password" value={c.secret || ""} onChange={(e) => setCred(i, "secret", e.target.value)} />
              </div>
            ))}
            <button type="button" style={C.btnGhost} onClick={() => setPlan({ ...plan, credentials: [...plan.credentials, {}] })}>
              + Add login
            </button>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button style={C.btn} disabled={busy || !gradeLevelId}>
            {busy ? "Posting…" : "Post request"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InternalCoverageForm({ request, onDone }) {
  const [type, setType] = useState("admin");
  const [staffName, setStaffName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form
      style={{ ...C.row, marginTop: 8, background: "#fffbeb", padding: 8, borderRadius: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!staffName.trim()) return;
        setBusy(true);
        setErr("");
        try {
          await api(`/api/subs-admin/requests/${request._id}/internal-coverage`, { method: "POST", body: { type, staffName, note } });
          onDone();
        } catch (e2) {
          setErr(e2.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>Cover internally:</span>
      <select style={{ ...C.input, width: 150 }} value={type} onChange={(e) => setType(e.target.value)}>
        <option value="admin">Admin covers</option>
        <option value="split-class">Split class</option>
        <option value="ea-reassign">Reassign EA</option>
        <option value="prep-coverage">Prep-period coverage</option>
        <option value="other">Other</option>
      </select>
      <input style={{ ...C.input, width: 150 }} placeholder="Staff name" value={staffName} onChange={(e) => setStaffName(e.target.value)} />
      <input style={{ ...C.input, width: 150 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button style={C.btn} disabled={busy}>
        Record
      </button>
      {err && <span style={{ color: "#b91c1c", fontSize: 12 }}>{err}</span>}
    </form>
  );
}

function FeedbackForm({ request, teacherId, teacherName, onDone }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [onTime, setOnTime] = useState(true);
  const [canTeach, setCanTeach] = useState(true);
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!teacherId) return null;
  if (done) return <span style={{ fontSize: 13, color: "#15803d" }}>Thanks — feedback saved.</span>;
  return (
    <div style={{ marginTop: 8 }}>
      <button style={C.btnGhost} onClick={() => setOpen((o) => !o)}>
        {open ? "Cancel" : `Rate ${teacherName || "this sub"} (private)`}
      </button>
      {open && (
        <form
          style={{ marginTop: 8, background: "#f8fafc", padding: 10, borderRadius: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/api/subs-admin/feedback", {
                method: "POST",
                body: { teacherId, schoolId: request.schoolId, requestId: request._id, rating: Number(rating), onTime, canTeach, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), note },
              });
              setDone(true);
              onDone && onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div style={C.row}>
            <label style={C.row}>
              Rating
              <select style={{ ...C.input, width: 60 }} value={rating} onChange={(e) => setRating(e.target.value)}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label style={C.row}>
              <input type="checkbox" checked={onTime} onChange={(e) => setOnTime(e.target.checked)} /> On time
            </label>
            <label style={C.row}>
              <input type="checkbox" checked={canTeach} onChange={(e) => setCanTeach(e.target.checked)} /> Genuinely taught
            </label>
          </div>
          <input style={{ ...C.input, marginTop: 6 }} placeholder='Tags e.g. "great with junior high"' value={tags} onChange={(e) => setTags(e.target.value)} />
          <input style={{ ...C.input, marginTop: 6 }} placeholder="Private note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button style={{ ...C.btn, marginTop: 8 }} disabled={busy}>
            Save feedback
          </button>
        </form>
      )}
    </div>
  );
}

function CandidatesView({ request }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  async function load() {
    setOpen((o) => !o);
    if (!data) {
      try {
        setData(await api(`/api/subs-admin/requests/${request._id}/candidates`));
      } catch {}
    }
  }
  return (
    <div style={{ marginTop: 6 }}>
      <button style={C.btnGhost} onClick={load}>
        {open ? "Hide candidates" : "Why? View candidates"}
      </button>
      {open && data && (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          {data.candidates.map((c) => (
            <div key={c.teacherId} style={C.row}>
              {c.eligible ? "✅" : "❌"} <span>{c.name}</span>
              {!c.eligible && <span style={{ color: "#b91c1c" }}>{c.reasons.join(", ")}</span>}
            </div>
          ))}
          {data.candidates.length === 0 && <span style={{ color: "#94a3b8" }}>No subs ranked for this grade yet.</span>}
        </div>
      )}
    </div>
  );
}

function RequestsBoard({ school }) {
  const [requests, setRequests] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { requests } = await api(`/api/subs-admin/schools/${school._id}/requests`);
      setRequests(requests);
    } catch (e) {
      setErr(e.message);
    }
  }, [school._id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // poll so escalation shows live
    return () => clearInterval(t);
  }, [load]);

  async function tick() {
    await api("/api/subs-admin/dev/tick", { method: "POST" }).catch(() => {});
    load();
  }
  async function cancel(rid) {
    await api(`/api/subs-admin/requests/${rid}/cancel`, { method: "POST" }).catch((e) => setErr(e.message));
    load();
  }

  return (
    <div style={C.card}>
      <div style={{ ...C.row, justifyContent: "space-between" }}>
        <h2 style={C.h2}>Requests</h2>
        <div style={C.row}>
          <button style={C.btnGhost} onClick={load}>
            Refresh
          </button>
          <button style={C.btnGhost} onClick={tick} title="Force one escalation sweep (dev)">
            Tick now (dev)
          </button>
        </div>
      </div>
      {err && <div style={C.err}>{err}</div>}
      {requests.length === 0 && <span style={{ color: "#94a3b8" }}>No requests yet.</span>}
      {requests.map((r) => (
        <div key={r._id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ ...C.row, justifyContent: "space-between" }}>
            <div style={C.row}>
              <strong>{r.gradeName}</strong>
              <span style={{ color: "#64748b" }}>{r.date}</span>
              <StatusPill status={r.status} />
              <span style={C.pill(r.urgency === "urgent" ? "#fef3c7" : "#e0e7ff", r.urgency === "urgent" ? "#92400e" : "#3730a3")}>{r.urgency}</span>
            </div>
            {r.status === "open" && (
              <button style={C.btnRed} onClick={() => cancel(r._id)}>
                Cancel
              </button>
            )}
          </div>
          {r.notes && <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{r.notes}</div>}
          {(r.requiredRole !== "teacher" || (r.requiredQualifications || []).length > 0) && (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
              Requires: {r.requiredRole}
              {(r.requiredQualifications || []).length > 0 ? ` · ${r.requiredQualifications.join(", ")}` : ""}
              {typeof r.eligibleCountAtPost === "number" ? ` · ${r.eligibleCountAtPost} qualified at post` : ""}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {r.offers.map((o) => (
              <div key={o._id} style={{ ...C.row, fontSize: 13, padding: "2px 0" }}>
                <span style={{ color: "#94a3b8", width: 28 }}>#{o.rank + 1}</span>
                <span style={{ minWidth: 140 }}>{o.teacherName}</span>
                <StatusPill status={o.status} />
                {o.status === "pending" && <span style={{ color: "#a16207" }}>{timeLeft(o.expiresAt)}</span>}
                {o.channels?.length > 0 && <span style={{ color: "#94a3b8" }}>via {o.channels.join(", ")}</span>}
              </div>
            ))}
            {r.offers.length === 0 && <span style={{ color: "#94a3b8", fontSize: 13 }}>No offers sent yet.</span>}
          </div>

          {r.status === "filled" && (
            <div style={{ marginTop: 6, fontSize: 13, color: "#15803d" }}>
              ✓ Covered {r.coverageType === "internal" ? "internally" : "by substitute"}
            </div>
          )}
          {r.status === "filled" && r.coverageType === "external" && (
            <FeedbackForm request={r} teacherId={r.filledByTeacherId} teacherName={r.offers.find((o) => o.status === "accepted")?.teacherName} onDone={load} />
          )}

          {r.status === "exhausted" && (
            <div style={{ marginTop: 8, background: "#fef2f2", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ color: "#b91c1c", fontWeight: 600, fontSize: 13 }}>
                {r.exhaustedReason === "no_eligible" ? "⚠ No qualified subs for this posting." : "⚠ All qualified subs declined or didn't respond."}
              </div>
              <CandidatesView request={r} />
              <InternalCoverageForm request={r} onDone={load} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LessonPlanView({ offerId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  async function load() {
    setOpen((o) => !o);
    if (!data) {
      try {
        setData(await api(`/api/subs-teacher/offers/${offerId}/lesson-plan`));
      } catch {}
    }
  }
  const plan = data?.plan;
  return (
    <div style={{ marginTop: 6 }}>
      <button style={C.btnGhost} onClick={load}>
        {open ? "Hide lesson plan" : "View lesson plan"}
      </button>
      {open &&
        (plan ? (
          <div style={{ marginTop: 8, background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 14 }}>
            {plan.body && (
              <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>
                <strong>Lesson:</strong> {plan.body}
              </p>
            )}
            {plan.routineNotes && (
              <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>
                <strong>Routines:</strong> {plan.routineNotes}
              </p>
            )}
            {plan.materialsLinks?.length > 0 && (
              <p style={{ margin: "0 0 8px" }}>
                <strong>Materials:</strong>{" "}
                {plan.materialsLinks.map((l, i) => (
                  <a key={i} href={l} target="_blank" rel="noreferrer" style={{ color: "#2563eb", marginRight: 8 }}>
                    link {i + 1}
                  </a>
                ))}
              </p>
            )}
            {plan.credentials?.length > 0 && (
              <div>
                <strong>Logins:</strong>
                {plan.credentials.map((c, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    {c.system}: {c.username}
                    {c.hasSecret && (c.secret !== undefined ? ` / ${c.secret}` : " / 🔒 password shown after you accept")}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 13 }}>No lesson plan attached.</div>
        ))}
    </div>
  );
}

// Staff teacher reports their own absence ("I am a teacher, I need a sub").
function RequestSubForm({ defaultName, onSubmitted }) {
  const today = new Date().toISOString().slice(0, 10);
  const [schools, setSchools] = useState([]);
  const [grades, setGrades] = useState([]);
  const [schoolId, setSchoolId] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [name, setName] = useState(defaultName || "");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("Sick");
  const [urgency, setUrgency] = useState("urgent");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/subs-teacher/all-schools").then(({ schools }) => setSchools(schools)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!schoolId) return setGrades([]);
    api(`/api/subs-teacher/schools/${schoolId}/grades`).then(({ grades }) => setGrades(grades)).catch(() => setGrades([]));
    setGradeLevelId("");
  }, [schoolId]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      await api("/api/subs-teacher/request-sub", { method: "POST", body: { schoolId, gradeLevelId, date, reason, urgency, notes, name } });
      setMsg("Submitted — your principal will approve it, then we start contacting subs. You'll be emailed when it's covered.");
      setNotes("");
      onSubmitted && onSubmitted();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...C.card, borderColor: "#bfdbfe", background: "#f8fbff" }}>
      <h2 style={C.h2}>🤒 I need a sub</h2>
      {err && <div style={C.err}>{err}</div>}
      {msg && <div style={{ ...C.err, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#15803d" }}>{msg}</div>}
      <form onSubmit={submit}>
        <div style={C.row}>
          <div>
            <label style={C.label}>School</label>
            <select style={{ ...C.input, width: 200 }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required>
              <option value="">Select…</option>
              {schools.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={C.label}>My class</label>
            <select style={{ ...C.input, width: 150 }} value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)} required disabled={!schoolId}>
              <option value="">Select…</option>
              {grades.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={C.label}>My name</label>
            <input style={{ ...C.input, width: 150 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
        </div>
        <div style={C.row}>
          <div>
            <label style={C.label}>Date</label>
            <input style={{ ...C.input, width: 150 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label style={C.label}>Reason</label>
            <select style={{ ...C.input, width: 160 }} value={reason} onChange={(e) => setReason(e.target.value)}>
              {["Sick", "Personal", "Professional development", "Bereavement", "Other"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={C.label}>Urgency</label>
            <select style={{ ...C.input, width: 160 }} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="urgent">Same day (urgent)</option>
              <option value="advance">Advance notice</option>
            </select>
          </div>
        </div>
        <label style={C.label}>Notes for your principal (optional)</label>
        <input style={C.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Plans are in the top drawer" />
        <div style={{ marginTop: 14 }}>
          <button style={C.btn} disabled={busy || !schoolId || !gradeLevelId}>
            {busy ? "Submitting…" : "Submit to principal"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MyRequests({ reloadKey }) {
  const [requests, setRequests] = useState([]);
  const load = useCallback(async () => {
    try {
      const { requests } = await api("/api/subs-teacher/my-requests");
      setRequests(requests);
    } catch {}
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load, reloadKey]);

  if (requests.length === 0) return null;
  return (
    <div style={C.card}>
      <h2 style={C.h2}>My absence requests</h2>
      {requests.map((r) => (
        <div key={r._id} style={{ ...C.row, fontSize: 14, padding: "4px 0" }}>
          <span style={{ minWidth: 90 }}>{r.date}</span>
          <span style={{ minWidth: 90 }}>{r.gradeName}</span>
          <span style={{ color: "#64748b", minWidth: 120 }}>{r.schoolName}</span>
          {r.reason && <span style={C.pill("#f1f5f9", "#334155")}>{r.reason}</span>}
          <StatusPill status={r.status === "pending_approval" ? "pending" : r.status} />
          {r.status === "denied" && r.denyReason && <span style={{ color: "#b91c1c", fontSize: 12 }}>{r.denyReason}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Teacher dashboard ─────────────────────────────────────────────────
function TeacherDashboard() {
  const [teacher, setTeacher] = useState(null);
  const [schools, setSchools] = useState([]);
  const [offers, setOffers] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [me, off] = await Promise.all([api("/api/subs-teacher/me"), api("/api/subs-teacher/offers")]);
      setTeacher(me.teacher);
      setSchools(me.schools || []);
      setOffers(off.offers);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function respond(id, action) {
    try {
      await api(`/api/subs-teacher/offers/${id}/${action}`, { method: "POST" });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const pending = offers.filter((o) => o.status === "pending");
  const history = offers.filter((o) => o.status !== "pending");
  const [reqKey, setReqKey] = useState(0);

  return (
    <div>
      {err && <div style={C.err}>{err}</div>}
      <RequestSubForm defaultName={teacher?.name} onSubmitted={() => setReqKey((k) => k + 1)} />
      <MyRequests reloadKey={reqKey} />
      {schools.length > 0 && (
        <div style={C.card}>
          <h2 style={C.h2}>My schools</h2>
          <div style={C.row}>
            {schools.map((s) => (
              <span key={s._id} style={C.pill("#eff6ff", "#1d4ed8")}>
                {s.abbrev ? `${s.abbrev} — ` : ""}
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {teacher && <TeacherProfile teacher={teacher} onSaved={load} />}

      <div style={C.card}>
        <h2 style={C.h2}>Pending offers</h2>
        {pending.length === 0 && <span style={{ color: "#94a3b8" }}>No pending offers right now.</span>}
        {pending.map((o) => (
          <div key={o._id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={C.row}>
              <strong>{o.request?.schoolAbbrev || o.request?.schoolName}</strong>
              <span>{o.request?.gradeName}</span>
              <span style={{ color: "#64748b" }}>
                {o.request?.date}
                {o.request?.startTime ? ` ${o.request.startTime}` : ""}
              </span>
              <span style={C.pill(o.request?.urgency === "urgent" ? "#fef3c7" : "#e0e7ff", o.request?.urgency === "urgent" ? "#92400e" : "#3730a3")}>
                {o.request?.urgency}
              </span>
              {o.request?.requiredRole && o.request.requiredRole !== "teacher" && <span style={C.pill("#f1f5f9", "#334155")}>{o.request.requiredRole}</span>}
              <span style={{ color: "#a16207", fontSize: 13 }}>{timeLeft(o.expiresAt)}</span>
            </div>
            {(o.request?.requiredQualifications || []).length > 0 && (
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>Subjects: {o.request.requiredQualifications.join(", ")}</div>
            )}
            {o.request?.notes && <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{o.request.notes}</div>}
            {o.request?.supportLevel && <div style={{ color: "#64748b", fontSize: 13 }}>Support: {o.request.supportLevel}</div>}
            {o.request?.hasLessonPlan && (
              <div style={{ fontSize: 13, marginTop: 4 }}>
                📋 Lesson plan {Math.round((o.request.lessonPlanCompleteness || 0) * 100)}% ready
              </div>
            )}
            <LessonPlanView offerId={o._id} />
            <div style={{ ...C.row, marginTop: 10 }}>
              <button style={C.btnGreen} onClick={() => respond(o._id, "accept")}>
                Accept
              </button>
              <button style={C.btnRed} onClick={() => respond(o._id, "decline")}>
                Skip
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={C.card}>
        <h2 style={C.h2}>History</h2>
        {history.length === 0 && <span style={{ color: "#94a3b8" }}>Nothing yet.</span>}
        {history.map((o) => (
          <div key={o._id} style={{ ...C.row, fontSize: 14, padding: "4px 0" }}>
            <span style={{ minWidth: 90 }}>{o.request?.date}</span>
            <span style={{ minWidth: 100 }}>{o.request?.gradeName}</span>
            <span style={{ color: "#64748b", minWidth: 140 }}>{o.request?.schoolName}</span>
            <StatusPill status={o.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TeacherProfile({ teacher, onSaved }) {
  const [name, setName] = useState(teacher.name || "");
  const [phone, setPhone] = useState(teacher.phone || "");
  const [email, setEmailPref] = useState(teacher.contactPrefs?.email !== false);
  const [sms, setSms] = useState(!!teacher.contactPrefs?.sms);
  const [active, setActive] = useState(teacher.active !== false);
  const [quals, setQuals] = useState((teacher.qualifications || []).join(", "));
  const [roleTypes, setRoleTypes] = useState(teacher.roleTypes?.length ? teacher.roleTypes : ["teacher"]);
  const [gradeComfort, setGradeComfort] = useState((teacher.gradeComfort || []).join(", "));
  const [faith, setFaith] = useState(teacher.faithFit || {});
  const [maxTravelKm, setMaxTravelKm] = useState(teacher.maxTravelKm ?? "");
  const [dayRate, setDayRate] = useState(teacher.dayRate ?? "");
  const [availabilityNote, setAvailabilityNote] = useState(teacher.availability?.note || "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function toggleRole(r) {
    setRoleTypes((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/subs-teacher/profile", {
        method: "PUT",
        body: {
          name,
          phone,
          active,
          contactPrefs: { email, sms },
          qualifications: quals.split(",").map((s) => s.trim()).filter(Boolean),
          roleTypes: roleTypes.length ? roleTypes : ["teacher"],
          gradeComfort: gradeComfort.split(",").map((s) => s.trim()).filter(Boolean),
          faithFit: faith,
          maxTravelKm: maxTravelKm === "" ? undefined : Number(maxTravelKm),
          dayRate: dayRate === "" ? undefined : Number(dayRate),
          availabilityNote,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={C.card}>
      <div style={{ ...C.row, justifyContent: "space-between" }}>
        <h2 style={C.h2}>My profile</h2>
        {saved && <span style={C.pill("#dcfce7", "#15803d")}>saved</span>}
      </div>
      <form onSubmit={save}>
        <div style={C.row}>
          <div>
            <label style={C.label}>Name</label>
            <input style={{ ...C.input, width: 180 }} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={C.label}>Phone (for SMS)</label>
            <input style={{ ...C.input, width: 150 }} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label style={C.label}>Day rate ($)</label>
            <input style={{ ...C.input, width: 100 }} type="number" value={dayRate} onChange={(e) => setDayRate(e.target.value)} />
          </div>
        </div>

        <label style={C.label}>Contact me by</label>
        <div style={C.row}>
          <label style={C.row}>
            <input type="checkbox" checked={email} onChange={(e) => setEmailPref(e.target.checked)} /> Email
          </label>
          <label style={C.row}>
            <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> SMS
          </label>
          <label style={{ ...C.row, marginLeft: 16 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Available for offers
          </label>
        </div>

        <label style={C.label}>I can serve as</label>
        <div style={C.row}>
          {[
            ["teacher", "Teacher"],
            ["ea", "Educational assistant"],
            ["specialist", "Specialist"],
            ["tech", "Tech"],
          ].map(([r, lbl]) => (
            <label key={r} style={C.row}>
              <input type="checkbox" checked={roleTypes.includes(r)} onChange={() => toggleRole(r)} /> {lbl}
            </label>
          ))}
        </div>

        <label style={C.label}>Subjects I'm certified to teach (comma-separated)</label>
        <input style={C.input} value={quals} onChange={(e) => setQuals(e.target.value)} placeholder="e.g. French, HS Math, Chemistry, SpEd" />

        <label style={C.label}>Grades I'm comfortable with (comma-separated)</label>
        <input style={C.input} value={gradeComfort} onChange={(e) => setGradeComfort(e.target.value)} placeholder="e.g. Grade 1, Grade 2, Kindergarten" />

        <div style={C.row}>
          <div>
            <label style={C.label}>Max travel (km)</label>
            <input style={{ ...C.input, width: 100 }} type="number" value={maxTravelKm} onChange={(e) => setMaxTravelKm(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={C.label}>Availability note</label>
            <input style={C.input} value={availabilityNote} onChange={(e) => setAvailabilityNote(e.target.value)} placeholder="e.g. Mornings only; not Fridays" />
          </div>
        </div>

        <label style={C.label}>Mission / faith fit (self-declared)</label>
        <div style={C.row}>
          {FAITH_OPTIONS.map(([k, lbl]) => (
            <label key={k} style={C.row}>
              <input type="checkbox" checked={!!faith[k]} onChange={(e) => setFaith((f) => ({ ...f, [k]: e.target.checked }))} /> {lbl}
            </label>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <button style={C.btn} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
