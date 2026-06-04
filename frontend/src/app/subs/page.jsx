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

// Identity for feedback/error reports (set once /me resolves). Non-secret.
const REPORTER = { email: "", name: "" };

// Breadcrumb trail — a ring buffer of recent actions so a feedback report
// or auto-captured error shows what the user tried and where they stopped.
// Kept small and non-sensitive (labels only, never form values).
const TRAIL = [];
function pushTrail(event) {
  try {
    const t = new Date().toISOString().slice(11, 19); // HH:MM:SS
    TRAIL.push(`${t} ${event}`);
    if (TRAIL.length > 25) TRAIL.shift();
  } catch {}
}

// Fire-and-forget feedback/error report → feedback-subs.txt (via backend).
// Never throws and never routes through api() (to avoid recursion on error).
function reportSubsFeedback(kind, message, { surface, context } = {}) {
  try {
    fetch(`${BACKEND_URL}/api/subs-feedback/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        kind,
        message: String(message || "").slice(0, 4000),
        surface: surface || (typeof window !== "undefined" ? window.location.pathname : "subs"),
        // Attach the recent-action trail + current view so triage can see
        // the path the user took and where it broke down.
        context: { ...(context || {}), trail: TRAIL.slice(-25), view: typeof window !== "undefined" ? window.location.pathname : "" },
        fromEmail: REPORTER.email,
        fromName: REPORTER.name,
      }),
    }).catch(() => {});
  } catch {}
}

async function api(path, { method = "GET", body } = {}) {
  pushTrail(`${method} ${path}`);
  let res;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    pushTrail(`✗ network ${method} ${path}`);
    // Network/transport failure — auto-report so it lands in feedback-subs.txt.
    reportSubsFeedback("error", `Network error on ${method} ${path}: ${netErr?.message || netErr}`, { surface: path });
    throw new Error("Network error — please check your connection and try again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) pushTrail(`✗ ${res.status} ${method} ${path}`);
  if (!res.ok) {
    // Auto-report server-side failures (5xx); 4xx are usually expected
    // (validation / not-signed-in) so we don't spam the log with those.
    if (res.status >= 500) {
      reportSubsFeedback("error", `${method} ${path} → ${res.status}: ${data?.error || "server error"}`, { surface: path, context: { status: res.status } });
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
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
    skipped: ["#fee2e2", "#b91c1c"],
    expired: ["#f1f5f9", "#64748b"],
    cancelled: ["#f1f5f9", "#64748b"],
  };
  const [bg, fg] = map[status] || ["#f1f5f9", "#64748b"];
  return <span style={C.pill(bg, fg)}>{status}</span>;
}

function clockTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function timeLeft(expiresAt) {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m left`;
  return `${Math.round(m / 60)}h left`;
}

// Display label for a coverage window.
function dayPartLabel(r) {
  if (!r) return "";
  if (r.dayPart === "am") return "Half day (AM)";
  if (r.dayPart === "pm") return "Half day (PM)";
  if (r.dayPart === "custom") return r.startTime && r.endTime ? `${r.startTime}–${r.endTime}` : "Specific times";
  return "Full day";
}

// Reusable whole/half/custom coverage-window picker.
function DayPartPicker({ dayPart, setDayPart, startTime, setStartTime, endTime, setEndTime }) {
  return (
    <div>
      <label style={C.label}>Coverage needed</label>
      <div style={C.row}>
        <select style={{ ...C.input, width: 170 }} value={dayPart} onChange={(e) => setDayPart(e.target.value)}>
          <option value="full">Whole day</option>
          <option value="am">Half day — AM only</option>
          <option value="pm">Half day — PM only</option>
          <option value="custom">Specific times</option>
        </select>
        {dayPart === "custom" && (
          <>
            <input style={{ ...C.input, width: 110 }} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <span style={{ color: "#64748b" }}>to</span>
            <input style={{ ...C.input, width: 110 }} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </>
        )}
      </div>
    </div>
  );
}

// Record a short voice clip for a sick day (MediaRecorder → data URL).
// If recording isn't possible (no mic, denied permission, unsupported
// browser), we DON'T trap the user: we surface a friendly note and call
// onFail() so the form can still be submitted (flagged for the approver).
function VoiceRecorder({ required, onChange, onFail }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [dataUrl, setDataUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const recRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const timerRef = React.useRef(null);
  const MAX = 60;

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";

  useEffect(() => {
    if (!supported) fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  function fail() {
    setFailed(true);
    onFail && onFail();
  }

  function stop() {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }

  async function start() {
    setFailed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          setDataUrl(reader.result);
          onChange(reader.result, Math.min(seconds, MAX));
        };
        reader.readAsDataURL(blob);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => (s + 1 >= MAX ? (stop(), MAX) : s + 1)), 1000);
    } catch {
      fail();
    }
  }

  function clear() {
    setDataUrl("");
    setSeconds(0);
    onChange("", 0);
  }

  return (
    <div style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 10, marginTop: 6 }}>
      <label style={{ ...C.label, marginTop: 0 }}>
        Voice note {required ? <span style={{ color: "#b91c1c" }}>(your school asks for one on sick days)</span> : "(optional)"}
      </label>
      {failed ? (
        <div style={{ fontSize: 13, color: "#92400e" }}>
          Couldn't access your microphone — no problem. You can still submit; your principal will be told the voice note couldn't be recorded.
        </div>
      ) : !dataUrl ? (
        <button type="button" style={recording ? C.btnRed : C.btnGhost} onClick={recording ? stop : start}>
          {recording ? `⏹ Stop (${seconds}s)` : "🎙 Record"}
        </button>
      ) : (
        <div style={C.row}>
          <audio controls src={dataUrl} style={{ height: 36 }} />
          <button type="button" style={C.btnGhost} onClick={clear}>
            Re-record
          </button>
        </div>
      )}
    </div>
  );
}

// Shared, normalized vocabularies so a sub's profile and a school's request
// requirements match on the same values (free text didn't reliably match).
const SUBJECT_OPTIONS = [
  "English/Language Arts", "Math", "HS Math", "Science", "Biology", "Chemistry", "Physics",
  "French", "Spanish", "Social Studies", "History", "Geography", "Music", "Art", "Drama",
  "Phys Ed", "Computer Science", "Tech", "Special Education", "ESL", "Religious Studies", "Early Years",
];
const GRADE_OPTIONS = [
  "Pre-K", "Kindergarten", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
];

// "Grade 5 (Mrs. Lackey)" — class identified by grade + absent teacher.
function classLabel(grade, absentName) {
  return absentName ? `${grade} (${absentName})` : grade;
}
// Google Maps navigation link to a school (for accepted assignments).
function gmapsUrl(name, address) {
  const dest = [name, address].filter(Boolean).join(", ");
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : "";
}

// Multi-select chip picker: common options as toggle chips + an "add your
// own" box. Value is an array of strings. Normalizes input so matching is
// reliable while still allowing custom entries.
function TagPicker({ options, value, onChange, placeholder = "add your own…" }) {
  const [custom, setCustom] = useState("");
  const selected = new Set(value);
  function toggle(v) {
    onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  function addCustom() {
    const v = custom.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setCustom("");
  }
  // Custom (off-list) selections so they remain visible/removable as chips.
  const extras = value.filter((v) => !options.includes(v));
  return (
    <div>
      <div style={{ ...C.row, gap: 6 }}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            style={selected.has(o) ? { ...C.pill("#2563eb", "#fff"), border: 0, cursor: "pointer" } : { ...C.pill("#f1f5f9", "#334155"), border: 0, cursor: "pointer" }}
          >
            {selected.has(o) ? "✓ " : ""}
            {o}
          </button>
        ))}
        {extras.map((o) => (
          <button key={o} type="button" onClick={() => toggle(o)} style={{ ...C.pill("#dbeafe", "#1d4ed8"), border: 0, cursor: "pointer" }}>
            ✓ {o} ✕
          </button>
        ))}
      </div>
      <div style={{ ...C.row, marginTop: 6 }}>
        <input
          style={{ ...C.input, width: 200 }}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" style={C.btnGhost} onClick={addCustom}>
          Add
        </button>
      </div>
    </div>
  );
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

// Floating "Feedback" widget — manual problem/suggestion reports. Errors
// are auto-reported by api(); this is the human channel. Both land in
// feedback-subs.txt via the backend.
function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("problem");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    reportSubsFeedback(kind, message.trim(), { surface: "manual" });
    setSent(true);
    setMessage("");
    setTimeout(() => {
      setSent(false);
      setOpen(false);
    }, 1400);
  }

  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 50 }}>
      {open && (
        <div style={{ ...C.card, width: 300, marginBottom: 8, boxShadow: "0 8px 30px rgba(0,0,0,.15)" }}>
          {sent ? (
            <div style={{ color: "#15803d", fontWeight: 600 }}>Thanks — sent! 🙏</div>
          ) : (
            <form onSubmit={submit}>
              <div style={{ ...C.row, justifyContent: "space-between" }}>
                <strong>Send feedback</strong>
                <button type="button" style={{ ...C.btnGhost, padding: "2px 8px" }} onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>
              <div style={{ ...C.row, marginTop: 8 }}>
                <label style={C.row}>
                  <input type="radio" checked={kind === "problem"} onChange={() => setKind("problem")} /> Problem
                </label>
                <label style={C.row}>
                  <input type="radio" checked={kind === "suggestion"} onChange={() => setKind("suggestion")} /> Idea
                </label>
              </div>
              <textarea
                style={{ ...C.input, minHeight: 80, marginTop: 8 }}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={kind === "problem" ? "What went wrong?" : "What would make this better?"}
              />
              <div style={{ marginTop: 8 }}>
                <button style={C.btn}>Send</button>
              </div>
            </form>
          )}
        </div>
      )}
      <button style={{ ...C.btn, borderRadius: 999, boxShadow: "0 4px 14px rgba(37,99,235,.4)" }} onClick={() => setOpen((o) => !o)}>
        💬 Feedback
      </button>
    </div>
  );
}

// First-login role chooser — removes the "principal lands as a teacher"
// confusion by making the very first choice explicit.
function RoleChooser({ onChoose }) {
  return (
    <div style={C.card}>
      <h2 style={{ ...C.h2, marginBottom: 4 }}>Welcome — what brings you here?</h2>
      <p style={{ color: "#64748b", marginTop: 0 }}>You can switch anytime; this just sets your starting screen.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
        <button style={{ ...C.btn, padding: 16, textAlign: "left" }} onClick={() => onChoose("admin")}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>I'm a principal / administrator</div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>Set up my school, rank subs, approve absences, manage settings.</div>
        </button>
        <button style={{ ...C.btnGhost, padding: 16, textAlign: "left" }} onClick={() => onChoose("teacher")}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>I'm a teacher or substitute</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Report an absence (need a sub), or accept/decline sub offers.</div>
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 12 }}>
        Teachers: if your principal sent you a sign-up link, open that link instead — it connects you to your school automatically.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
export default function SubsPage() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("admin"); // 'admin' | 'vp' | 'teacher'
  const [roleChosen, setRoleChosen] = useState(false); // dismissed the first-login chooser

  const refreshMe = useCallback(async () => {
    try {
      const data = await api("/api/subs-auth/me");
      REPORTER.email = data.email || "";
      REPORTER.name = data.teacher?.name || "";
      setMe(data);
      // Land on the most relevant view: admins on admin, VP-only users on
      // the approvals view, everyone else on the teacher view.
      setView(data.isAdmin ? "admin" : data.isVp ? "vp" : "teacher");
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const [invite, setInvite] = useState(null);
  const [staffToken, setStaffToken] = useState(null);
  const [inviteMsg, setInviteMsg] = useState("");

  useEffect(() => {
    // Capture tokens from links: ?invite=… (substitute) / ?staff=… (staff).
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("invite")) setInvite(p.get("invite"));
      if (p.get("staff")) setStaffToken(p.get("staff"));
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

  // A staff join link shows the join form (name + grade) on the teacher
  // view; the form completes the connection.
  useEffect(() => {
    if (me && staffToken) setView("teacher");
  }, [me, staffToken]);

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
          {staffToken && (
            <div style={{ ...C.err, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
              Sign in to connect to your school — then you can request a sub whenever you're away.
            </div>
          )}
          <SignIn onSignedIn={refreshMe} />
          <div style={{ ...C.row, marginTop: 14 }}>
            <a href="/subs/features" style={{ ...C.btnGhost, textDecoration: "none", display: "inline-block" }}>
              ✨ See features
            </a>
          </div>
        </div>
        <FeedbackWidget />
      </div>
    );
  }

  // Always offer both roles — anyone can post requests as a school admin
  // (create a school) or act as a substitute.
  const showSwitch = true;
  // First login with no established role yet → ask whether they're an
  // administrator setting up a school, or a teacher/sub. (Skipped when they
  // arrived via an invite or staff link — their role is already implied.)
  const noRole = !me.isAdmin && !me.isVp && !me.isTeacher;
  const showChooser = noRole && !roleChosen && !invite && !staffToken;
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

        {staffToken && (
          <StaffJoinForm
            token={staffToken}
            defaultName={me.teacher?.name}
            onJoined={(schoolName) => {
              setStaffToken(null);
              setInviteMsg(`Connected to ${schoolName} — you can report absences from the Teacher view.`);
              setView("teacher");
            }}
          />
        )}

        {showChooser ? (
          <RoleChooser
            onChoose={(v) => {
              pushTrail(`role chosen: ${v}`);
              setRoleChosen(true);
              setView(v);
            }}
          />
        ) : (
          <>
            {showSwitch && (
              <div style={{ ...C.row, marginBottom: 16 }}>
                <button style={view === "admin" ? C.btn : C.btnGhost} onClick={() => { pushTrail("view: admin"); setView("admin"); }}>
                  Principal / Admin
                </button>
                {me.isVp && (
                  <button style={view === "vp" ? C.btn : C.btnGhost} onClick={() => { pushTrail("view: vp"); setView("vp"); }}>
                    Approvals (VP)
                  </button>
                )}
                <button style={view === "teacher" ? C.btn : C.btnGhost} onClick={() => { pushTrail("view: teacher"); setView("teacher"); }}>
                  Teacher / Sub
                </button>
              </div>
            )}

            {view === "admin" && <AdminDashboard />}
            {view === "vp" && <VpDashboard />}
            {view === "teacher" && <TeacherDashboard />}
          </>
        )}
      </div>
      <FeedbackWidget />
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
              <span>{classLabel(r.gradeName, r.absentTeacher?.name)}</span>
              <span style={C.pill("#f1f5f9", "#334155")}>{dayPartLabel(r)}</span>
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

function VoiceNotePlayer({ requestId }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const r = await api(`/api/subs-admin/requests/${requestId}/voice-note`);
      setUrl(r.dataUrl);
    } catch {}
    setLoading(false);
  }
  if (url) return <audio controls src={url} style={{ height: 34, verticalAlign: "middle" }} />;
  return (
    <button type="button" style={C.btnGhost} onClick={load} disabled={loading}>
      {loading ? "Loading…" : "🎙 Play voice note"}
    </button>
  );
}

// ── Approvals queue (teacher-submitted absence requests) ──────────────
function ApprovalRow({ a, onDone }) {
  const [role, setRole] = useState("teacher");
  const [quals, setQuals] = useState([]);
  const [urgency, setUrgency] = useState(a.urgency || "urgent");
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/subs-admin/requests/${a._id}/approve`, {
        method: "POST",
        body: { requiredRole: role, requiredQualifications: quals, urgency },
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
      {a.hasVoiceNote && (
        <div style={{ marginTop: 6 }}>
          <VoiceNotePlayer requestId={a._id} />
        </div>
      )}
      {a.voiceNoteStatus === "failed" && (
        <div style={{ marginTop: 6, fontSize: 13, color: "#92400e" }}>🎙 Voice note couldn't be recorded on the teacher's device.</div>
      )}
      {a.canApprove === false ? (
        <div style={{ marginTop: 8, fontSize: 13, color: "#92400e" }}>Awaiting principal — you don't have approval authority for this absence.</div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={C.row}>
            <select style={{ ...C.input, width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="teacher">Teacher</option>
              <option value="ea">EA</option>
              <option value="specialist">Specialist</option>
              <option value="tech">Tech</option>
            </select>
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
          <div style={{ marginTop: 8 }}>
            <label style={{ ...C.label, marginTop: 0 }}>Required qualifications (optional)</label>
            <TagPicker options={SUBJECT_OPTIONS} value={quals} onChange={setQuals} placeholder="add a subject…" />
          </div>
        </div>
      )}
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

function ApprovalsQueue({ emptyNote }) {
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

  if (approvals.length === 0) return emptyNote ? <div style={C.card}>{emptyNote}</div> : null;
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

// VP-only view: just the approvals they're scoped to handle.
function VpDashboard() {
  return (
    <div>
      <div style={C.card}>
        <h2 style={{ ...C.h2, marginBottom: 4 }}>VP approvals</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Absences awaiting your approval. What you can approve depends on the principal's policy for your school.
        </p>
      </div>
      <ApprovalsQueue emptyNote="Nothing awaiting your approval right now." />
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
        {schools.length === 0 && (
          <div style={{ ...C.err, background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
            You don't administer any school yet. Creating one below makes you its administrator. If your school is already set up,
            you don't create another — ask its principal to send you the staff sign-up link (then use the Teacher / Sub view).
          </div>
        )}
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
      <AbsenceReport school={school} />
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
  const [divisions, setDivisions] = useState(school.divisions || []);
  const [vpApproval, setVpApproval] = useState(school.vpApproval || "none");
  const [requireSickVoice, setRequireSickVoice] = useState(!!school.requireSickVoiceNote);
  const [adminPhone, setAdminPhone] = useState(school.adminPhone || "");
  const [address, setAddress] = useState(school.address || "");
  const [phone, setPhone] = useState(school.phone || "");
  const [email, setEmail] = useState(school.email || "");
  const [morningStart, setMorningStart] = useState(school.hours?.morningStart || "");
  const [morningEnd, setMorningEnd] = useState(school.hours?.morningEnd || "");
  const [dayStart, setDayStart] = useState(school.hours?.dayStart || "");
  const [dayEnd, setDayEnd] = useState(school.hours?.dayEnd || "");
  const [testMsg, setTestMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [staffLink, setStaffLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/subs-admin/schools/${school._id}`, {
        method: "PATCH",
        body: { abbrev, bellTime, faithFitEnabled: faith, subBudgetTotal: budget === "" ? undefined : Number(budget), vpEmail, financeEmail, vpApproval, requireSickVoiceNote: requireSickVoice, adminPhone, address, phone, email, morningStart, morningEnd, dayStart, dayEnd, divisions: divisions.filter((d) => d.name?.trim()) },
      });
      onSaved();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTestMsg("");
    if (!adminPhone.trim()) {
      setTestMsg("Enter your mobile number first.");
      return;
    }
    setTesting(true);
    try {
      const r = await api("/api/subs-teacher/test-sms", { method: "POST", body: { phone: adminPhone } });
      setTestMsg(r.mock ? "Sent in test mode — SMS isn't switched on yet (email still works)." : "Test sent — check your phone 📲");
    } catch (e) {
      setTestMsg(e.message);
    } finally {
      setTesting(false);
    }
  }

  const [copied, setCopied] = useState(false);
  async function makeStaffLink() {
    const r = await api(`/api/subs-admin/schools/${school._id}/staff-link`, { method: "POST" });
    setStaffLink(r.link);
    // Build a ready-to-send email and put it on the clipboard.
    const email =
      `Dear Teachers,\n\n` +
      `We're now using Curriculate Subs to arrange substitute coverage. Please take a minute to connect your account:\n\n` +
      `1. Open this link: ${r.link}\n` +
      `2. Sign in with your school email (you'll receive a 6-digit code).\n` +
      `3. Enter your name and the grade you teach.\n\n` +
      `Once you're connected, whenever you're going to be away you can request a substitute right from the app — just pick the date and whether it's a whole day, half day, or specific times. Your VP and I are notified automatically, and you'll get an email as soon as the class is covered.\n\n` +
      `Thanks,\n${school.name} Administration`;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
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
              <label style={C.label}>Sub budget ($)</label>
              <input style={{ ...C.input, width: 120 }} type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <label style={C.label}>School address</label>
            <input style={C.input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 School St, City" />
          </div>
          <div style={C.row}>
            <div>
              <label style={C.label}>School phone</label>
              <input style={{ ...C.input, width: 180 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(905) 555-1234" />
            </div>
            <div>
              <label style={C.label}>School email</label>
              <input style={{ ...C.input, width: 220 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="office@school.org" />
            </div>
          </div>

          <label style={{ ...C.label, marginTop: 10 }}>School hours</label>
          <div style={C.row}>
            <div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Morning</div>
              <div style={C.row}>
                <input style={{ ...C.input, width: 110 }} type="time" value={morningStart} onChange={(e) => setMorningStart(e.target.value)} />
                <span style={{ color: "#64748b" }}>to</span>
                <input style={{ ...C.input, width: 110 }} type="time" value={morningEnd} onChange={(e) => setMorningEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Full day</div>
              <div style={C.row}>
                <input style={{ ...C.input, width: 110 }} type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
                <span style={{ color: "#64748b" }}>to</span>
                <input style={{ ...C.input, width: 110 }} type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 0" }}>Morning end doubles as the afternoon (PM half-day) start. The full-day start drives the morning countdown.</p>
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
            On a fill, the appropriate VP (the division's, else the default) and finance are notified automatically — you're done.
          </p>

          <label style={{ ...C.label, marginTop: 12 }}>Divisions (VP by grade range)</label>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 6px" }}>e.g. "JK–Grade 5" → VP. Assign each grade to a division under Grade levels.</p>
          {divisions.map((d, i) => (
            <div key={i} style={{ ...C.row, marginBottom: 6 }}>
              <input
                style={{ ...C.input, width: 150 }}
                placeholder="JK–Grade 5"
                value={d.name || ""}
                onChange={(e) => setDivisions(divisions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                style={{ ...C.input, width: 220 }}
                placeholder="VP email"
                value={d.vpEmail || ""}
                onChange={(e) => setDivisions(divisions.map((x, j) => (j === i ? { ...x, vpEmail: e.target.value } : x)))}
              />
              <button type="button" style={C.btnRed} onClick={() => setDivisions(divisions.filter((_, j) => j !== i))}>
                remove
              </button>
            </div>
          ))}
          <button type="button" style={C.btnGhost} onClick={() => setDivisions([...divisions, { name: "", vpEmail: "" }])}>
            + Add division
          </button>
          <div style={{ marginTop: 10 }}>
            <label style={C.label}>Your mobile (text me when a sub is confirmed + test SMS)</label>
            <div style={C.row}>
              <input style={{ ...C.input, width: 180 }} value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="+1 555 123 4567" />
              <button type="button" style={C.btnGhost} onClick={sendTest} disabled={testing || !adminPhone.trim()}>
                {testing ? "Sending…" : "Send test SMS"}
              </button>
            </div>
            {testMsg && <div style={{ fontSize: 12, color: testMsg.includes("check your phone") ? "#15803d" : "#92400e", marginTop: 4 }}>{testMsg}</div>}
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={C.label}>VP can approve absences</label>
            <select style={{ ...C.input, width: 280 }} value={vpApproval} onChange={(e) => setVpApproval(e.target.value)}>
              <option value="none">Only the principal approves</option>
              <option value="sick_only">VP can approve sick days only</option>
              <option value="all">VP can approve all absences</option>
            </select>
          </div>
          <label style={{ ...C.row, marginTop: 10 }}>
            <input type="checkbox" checked={requireSickVoice} onChange={(e) => setRequireSickVoice(e.target.checked)} /> Require a voice note for sick days
          </label>
          <label style={{ ...C.row, marginTop: 10 }}>
            <input type="checkbox" checked={faith} onChange={(e) => setFaith(e.target.checked)} /> Enable mission / faith-fit attributes
          </label>
          <div style={{ marginTop: 12 }}>
            <button style={C.btn} onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
          <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 14, paddingTop: 12 }}>
            <label style={C.label}>Staff sign-up link</label>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>
              Send this to all staff. When a teacher opens it (and signs in), they're connected to this school and can report absences.
            </p>
            <div style={C.row}>
              <button type="button" style={C.btn} onClick={makeStaffLink}>
                {staffLink ? "Copy email again" : "Copy staff email"}
              </button>
              {copied && <span style={C.pill("#dcfce7", "#15803d")}>✓ Email copied — paste into your mail app</span>}
            </div>
            {staffLink && <code style={{ fontSize: 12, background: "#f1f5f9", padding: "4px 8px", borderRadius: 6, display: "inline-block", marginTop: 8 }}>{staffLink}</code>}
          </div>
        </div>
      )}
    </div>
  );
}

function GradeVpRow({ school, grade }) {
  const [division, setDivision] = useState(grade.division || "");
  const [saved, setSaved] = useState(false);
  const divs = school.divisions || [];
  async function save(val) {
    setDivision(val);
    await api(`/api/subs-admin/schools/${school._id}/grades/${grade._id}`, { method: "PATCH", body: { division: val } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }
  const vp = divs.find((d) => d.name === division)?.vpEmail || school.vpEmail || "";
  return (
    <div style={{ ...C.row, marginBottom: 4 }}>
      <span style={{ ...C.pill("#f1f5f9", "#334155"), minWidth: 90 }}>{grade.name}</span>
      {divs.length ? (
        <select style={{ ...C.input, width: 180 }} value={division} onChange={(e) => save(e.target.value)}>
          <option value="">— no division —</option>
          {divs.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      ) : (
        <span style={{ color: "#94a3b8", fontSize: 12 }}>Add divisions in Settings first</span>
      )}
      {vp && <span style={{ color: "#64748b", fontSize: 12 }}>VP: {vp}</span>}
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
  const [dayPart, setDayPart] = useState("full");
  const [endTime, setEndTime] = useState("11:00");
  const [requiredRole, setRequiredRole] = useState("teacher");
  const [quals, setQuals] = useState([]);
  const [notes, setNotes] = useState("");
  const [difficultyNote, setDifficultyNote] = useState("");
  const [supportLevel, setSupportLevel] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [absentName, setAbsentName] = useState("");
  const [absentEmail, setAbsentEmail] = useState("");
  const [staff, setStaff] = useState([]);
  const [faith, setFaith] = useState({});
  const [showPlan, setShowPlan] = useState(false);

  useEffect(() => {
    api(`/api/subs-admin/schools/${school._id}/staff`).then(({ staff }) => setStaff(staff)).catch(() => {});
  }, [school._id]);

  // Picking a staff member fills in the absent teacher and their class.
  function pickStaff(id) {
    const s = staff.find((x) => x._id === id);
    if (!s) {
      setAbsentName("");
      setAbsentEmail("");
      return;
    }
    setAbsentName(s.name || "");
    setAbsentEmail(s.email || "");
    if (s.gradeLevelId && grades.some((g) => g._id === String(s.gradeLevelId))) setGradeLevelId(String(s.gradeLevelId));
  }
  const [plan, setPlan] = useState({ body: "", routineNotes: "", materials: "", credentials: [] });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gradeLevelId && grades[0]) setGradeLevelId(grades[0]._id);
  }, [grades, gradeLevelId]);

  async function submit(e) {
    e.preventDefault();
    pushTrail("submit: post-request");
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
        dayPart,
        endTime: dayPart === "custom" ? endTime : "",
        requiredRole,
        requiredQualifications: quals,
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
      setQuals([]);
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

        <DayPartPicker dayPart={dayPart} setDayPart={setDayPart} startTime={startTime} setStartTime={setStartTime} endTime={endTime} setEndTime={setEndTime} />

        <label style={C.label}>Required qualifications</label>
        <TagPicker options={SUBJECT_OPTIONS} value={quals} onChange={setQuals} placeholder="add a subject…" />

        <div style={C.row}>
          {staff.length > 0 && (
            <div>
              <label style={C.label}>Request a day off for a staff teacher</label>
              <select style={{ ...C.input, width: 200 }} onChange={(e) => pickStaff(e.target.value)} defaultValue="">
                <option value="">— choose / or type below —</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name || s.email}
                  </option>
                ))}
              </select>
            </div>
          )}
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

function AbsenceReport({ school }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await api(`/api/subs-admin/schools/${school._id}/absence-report?${qs.toString()}`);
    setRows(r.rows);
  }, [school._id, from, to]);

  async function emailReport() {
    setMsg("");
    const r = await api(`/api/subs-admin/schools/${school._id}/absence-report/email`, { method: "POST", body: { from: from || undefined, to: to || undefined } });
    setMsg(`Report emailed to ${r.sentTo}.`);
  }

  return (
    <div style={C.card}>
      <div style={{ ...C.row, justifyContent: "space-between" }}>
        <h2 style={{ ...C.h2, marginBottom: 0 }}>Absence report</h2>
        <button
          style={C.btnGhost}
          onClick={() => {
            setOpen((o) => !o);
            if (!rows) load();
          }}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={C.row}>
            <label style={C.row}>
              From <input style={{ ...C.input, width: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={C.row}>
              To <input style={{ ...C.input, width: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button style={C.btnGhost} onClick={load}>
              Apply
            </button>
            <button style={C.btn} onClick={emailReport}>
              Email me this report
            </button>
          </div>
          {msg && <div style={{ ...C.err, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#15803d", marginTop: 8 }}>{msg}</div>}
          <div style={{ marginTop: 12 }}>
            {rows && rows.length === 0 && <span style={{ color: "#94a3b8" }}>No absences in this period.</span>}
            {rows &&
              rows.map((r) => (
                <div key={r.email} style={{ ...C.row, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ minWidth: 180, fontWeight: 600 }}>{r.name || r.email}</span>
                  <span style={C.pill("#eff6ff", "#1d4ed8")}>{r.total} absence(s)</span>
                  {Object.entries(r.byReason).map(([k, v]) => (
                    <span key={k} style={C.pill("#f1f5f9", "#334155")}>
                      {k}: {v}
                    </span>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// AI-assisted suggestions for a hard-to-fill request + override-offer.
function SmartMatch({ request, onOffered }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setOpen(true);
    setBusy(true);
    setMsg("");
    try {
      const r = await api(`/api/subs-admin/requests/${request._id}/smart-match`, { method: "POST" });
      setList(r.suggestions || []);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function offer(tid) {
    setMsg("");
    try {
      await api(`/api/subs-admin/requests/${request._id}/offer/${tid}`, { method: "POST" });
      setMsg("Offer sent.");
      onOffered && onOffered();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button style={C.btnGhost} onClick={open ? () => setOpen(false) : run}>
        {open ? "Hide smart match" : "✨ Smart match"}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {busy && <span style={{ color: "#64748b", fontSize: 13 }}>Finding the closest subs…</span>}
          {msg && <div style={{ fontSize: 12, color: msg === "Offer sent." ? "#15803d" : "#92400e" }}>{msg}</div>}
          {list &&
            list.map((s) => (
              <div key={s.teacherId} style={{ ...C.row, fontSize: 13, padding: "3px 0" }}>
                <span style={C.pill(s.fit >= 70 ? "#dcfce7" : s.fit >= 40 ? "#fef9c3" : "#f1f5f9", s.fit >= 70 ? "#15803d" : s.fit >= 40 ? "#a16207" : "#334155")}>{s.fit}%</span>
                <strong>{s.name}</strong>
                {s.eligible ? <span style={C.pill("#dcfce7", "#15803d")}>qualified</span> : <span style={C.pill("#fef3c7", "#92400e")}>near match</span>}
                <span style={{ color: "#64748b" }}>{s.reason}</span>
                <button style={C.btnGhost} onClick={() => offer(s.teacherId)}>
                  Offer
                </button>
              </div>
            ))}
          {list && list.length === 0 && <span style={{ color: "#94a3b8", fontSize: 13 }}>No candidates to suggest.</span>}
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
              <strong>{classLabel(r.gradeName, r.absentTeacher?.name)}</strong>
              <span style={{ color: "#64748b" }}>{r.date}</span>
              <span style={C.pill("#f1f5f9", "#334155")}>{dayPartLabel(r)}</span>
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
              <div key={o._id} style={{ ...C.row, fontSize: 13, padding: "3px 0", borderBottom: "1px solid #f8fafc" }}>
                <span style={{ color: "#94a3b8", width: 28 }}>{o.rank >= 0 ? `#${o.rank + 1}` : "★"}</span>
                <span style={{ minWidth: 130, fontWeight: 600 }}>{o.teacherName}</span>
                {o.teacherPhone ? (
                  <a href={`tel:${o.teacherPhone.replace(/[^\d+]/g, "")}`} style={{ color: "#2563eb", textDecoration: "none" }} title="Call this sub">
                    📞 {o.teacherPhone}
                  </a>
                ) : o.teacherEmail ? (
                  <a href={`mailto:${o.teacherEmail}`} style={{ color: "#2563eb", textDecoration: "none" }} title="Email this sub">
                    ✉️ {o.teacherEmail}
                  </a>
                ) : null}
                <StatusPill status={o.status === "declined" ? "skipped" : o.status} />
                {o.sentAt && <span style={{ color: "#94a3b8" }}>contacted {clockTime(o.sentAt)}</span>}
                {o.respondedAt && o.status !== "pending" && <span style={{ color: "#94a3b8" }}>· replied {clockTime(o.respondedAt)}</span>}
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
              <SmartMatch request={r} onOffered={load} />
              <InternalCoverageForm request={r} onDone={load} />
            </div>
          )}
          {r.status === "open" && <SmartMatch request={r} onOffered={load} />}
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

// Complete connection via the principal's staff link: name + grade level.
// Storing the grade is what lets the system know the teacher's VP.
function StaffJoinForm({ token, defaultName, onJoined }) {
  const [school, setSchool] = useState(null);
  const [grades, setGrades] = useState([]);
  const [name, setName] = useState(defaultName || "");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/subs-teacher/staff-invite/${encodeURIComponent(token)}`)
      .then((r) => {
        setSchool(r.school);
        setGrades(r.grades);
      })
      .catch((e) => setErr(e.message));
  }, [token]);

  const vp = grades.find((g) => g._id === gradeLevelId)?.vpEmail;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/subs-teacher/join-staff", { method: "POST", body: { token, name, gradeLevelId } });
      onJoined(school?.name || "your school");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...C.card, borderColor: "#bfdbfe", background: "#f8fbff" }}>
      <h2 style={C.h2}>Join {school?.name || "your school"}</h2>
      {err && <div style={C.err}>{err}</div>}
      <p style={{ fontSize: 13, color: "#64748b", marginTop: -6 }}>Tell us your name and the grade you teach so we route absences to the right VP.</p>
      <form onSubmit={submit}>
        <div style={C.row}>
          <div>
            <label style={C.label}>Your name</label>
            <input style={{ ...C.input, width: 200 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
          </div>
          <div>
            <label style={C.label}>Grade you teach</label>
            <select style={{ ...C.input, width: 160 }} value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)} required>
              <option value="">Select…</option>
              {grades.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {vp && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Your VP: {vp}</div>}
        <div style={{ marginTop: 12 }}>
          <button style={C.btn} disabled={busy || !gradeLevelId}>
            {busy ? "Connecting…" : "Connect to this school"}
          </button>
        </div>
      </form>
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
  const [dayPart, setDayPart] = useState("full");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [notes, setNotes] = useState("");
  const [myGrades, setMyGrades] = useState({}); // schoolId → my grade
  const [voiceDataUrl, setVoiceDataUrl] = useState("");
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedSchool = schools.find((s) => s._id === schoolId);
  const isSick = reason === "Sick";
  const voiceRequired = !!selectedSchool?.requireSickVoiceNote && isSick;

  useEffect(() => {
    // Prefer schools the teacher is connected to (via the staff link); fall
    // back to the full list if they haven't joined one yet.
    (async () => {
      try {
        const mine = await api("/api/subs-teacher/my-staff-schools");
        if (mine.schools?.length) {
          setSchools(mine.schools);
          setMyGrades(Object.fromEntries(mine.schools.map((s) => [s._id, s.myGradeLevelId]).filter(([, g]) => g)));
          setSchoolId(mine.schools[0]._id);
          return;
        }
      } catch {}
      try {
        const all = await api("/api/subs-teacher/all-schools");
        setSchools(all.schools);
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (!schoolId) return setGrades([]);
    api(`/api/subs-teacher/schools/${schoolId}/grades`)
      .then(({ grades }) => {
        setGrades(grades);
        // Pre-select the grade this teacher teaches (so the right VP is used).
        const mine = myGrades[schoolId];
        setGradeLevelId(mine && grades.some((g) => g._id === mine) ? mine : "");
      })
      .catch(() => setGrades([]));
  }, [schoolId, myGrades]);

  async function submit(e) {
    e.preventDefault();
    pushTrail(`submit: request-sub (${reason})`);
    setErr("");
    setMsg("");
    // Only insist on a voice note when one is required AND recording is
    // actually working — never trap a teacher whose mic failed.
    if (voiceRequired && !voiceDataUrl && !voiceFailed) {
      setErr("Your school asks for a voice note on sick days — please record one (or it'll note that recording failed).");
      return;
    }
    setBusy(true);
    try {
      await api("/api/subs-teacher/request-sub", {
        method: "POST",
        body: {
          schoolId,
          gradeLevelId,
          date,
          reason,
          urgency,
          notes,
          name,
          dayPart,
          startTime: dayPart === "custom" ? startTime : "",
          endTime: dayPart === "custom" ? endTime : "",
          voiceNote: voiceDataUrl ? { dataUrl: voiceDataUrl, durationSec: voiceDuration } : undefined,
          voiceNoteFailed: voiceFailed && !voiceDataUrl,
        },
      });
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
        <DayPartPicker dayPart={dayPart} setDayPart={setDayPart} startTime={startTime} setStartTime={setStartTime} endTime={endTime} setEndTime={setEndTime} />
        {isSick && (
          <VoiceRecorder
            required={voiceRequired}
            onChange={(url, dur) => {
              setVoiceDataUrl(url);
              setVoiceDuration(dur);
              if (url) setVoiceFailed(false);
            }}
            onFail={() => setVoiceFailed(true)}
          />
        )}
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

function MyAbsences({ reloadKey }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/api/subs-teacher/my-absences").then(setData).catch(() => {});
  }, [reloadKey]);
  if (!data || data.total === 0) return null;
  return (
    <div style={C.card}>
      <h2 style={C.h2}>My absence record</h2>
      <div style={C.row}>
        <span style={C.pill("#eff6ff", "#1d4ed8")}>{data.total} total</span>
        {Object.entries(data.byReason).map(([k, v]) => (
          <span key={k} style={C.pill("#f1f5f9", "#334155")}>
            {k}: {v}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {data.absences.slice(0, 12).map((a, i) => (
          <div key={i} style={{ ...C.row, fontSize: 13, padding: "2px 0" }}>
            <span style={{ minWidth: 90 }}>{a.date}</span>
            <span style={{ minWidth: 100 }}>{a.gradeName}</span>
            <span style={{ color: "#64748b" }}>{a.reason}</span>
            <StatusPill status={a.status === "pending_approval" ? "pending" : a.status} />
          </div>
        ))}
      </div>
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

  async function markPaid(id, paid) {
    try {
      await api(`/api/subs-teacher/offers/${id}/paid`, { method: "POST", body: { paid } });
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
      <MyAbsences reloadKey={reqKey} />
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
              <span>{classLabel(o.request?.gradeName, o.request?.absentTeacherName)}</span>
              <span style={{ color: "#64748b" }}>{o.request?.date}</span>
              <span style={C.pill("#f1f5f9", "#334155")}>{dayPartLabel(o.request)}</span>
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
            {o.request?.schoolAddress && (
              <div style={{ fontSize: 13, marginTop: 4 }}>
                📍 {o.request.schoolAddress} ·{" "}
                <a href={gmapsUrl(o.request.schoolName, o.request.schoolAddress)} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                  Directions
                </a>
              </div>
            )}
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
            <span style={{ minWidth: 120 }}>{classLabel(o.request?.gradeName, o.request?.absentTeacherName)}</span>
            <span style={{ color: "#64748b", minWidth: 140 }}>{o.request?.schoolName}</span>
            <StatusPill status={o.status} />
            {o.status === "accepted" && o.request?.schoolAddress && (
              <a href={gmapsUrl(o.request.schoolName, o.request.schoolAddress)} target="_blank" rel="noreferrer" style={{ ...C.btnGhost, textDecoration: "none" }}>
                📍 Navigate
              </a>
            )}
            {o.status === "accepted" && o.request?.status === "filled" && (
              <button style={C.btnRed} onClick={() => respond(o._id, "cancel")}>
                Cancel my acceptance
              </button>
            )}
            {o.status === "accepted" &&
              (o.paid ? (
                <button style={{ ...C.pill("#dcfce7", "#15803d"), border: 0, cursor: "pointer" }} onClick={() => markPaid(o._id, false)} title="Tap to undo">
                  ✓ Paid
                </button>
              ) : (
                <button style={C.btnGhost} onClick={() => markPaid(o._id, true)}>
                  Mark paid
                </button>
              ))}
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
  const [quals, setQuals] = useState(teacher.qualifications || []);
  const [roleTypes, setRoleTypes] = useState(teacher.roleTypes?.length ? teacher.roleTypes : ["teacher"]);
  const [gradeComfort, setGradeComfort] = useState(teacher.gradeComfort || []);
  const [faith, setFaith] = useState(teacher.faithFit || {});
  const [maxTravelKm, setMaxTravelKm] = useState(teacher.maxTravelKm ?? "");
  const [dayRate, setDayRate] = useState(teacher.dayRate ?? "");
  const [availabilityNote, setAvailabilityNote] = useState(teacher.availability?.note || "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testing, setTesting] = useState(false);

  function toggleRole(r) {
    setRoleTypes((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  async function sendTest() {
    setTestMsg("");
    if (!phone.trim()) {
      setTestMsg("Enter a phone number first.");
      return;
    }
    setTesting(true);
    try {
      const r = await api("/api/subs-teacher/test-sms", { method: "POST", body: { phone } });
      setTestMsg(r.mock ? "Sent in test mode — SMS isn't switched on yet." : "Test sent — check your phone 📲");
    } catch (e) {
      setTestMsg(e.message);
    } finally {
      setTesting(false);
    }
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
          qualifications: quals,
          roleTypes: roleTypes.length ? roleTypes : ["teacher"],
          gradeComfort,
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
            <div style={C.row}>
              <input style={{ ...C.input, width: 150 }} value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button type="button" style={C.btnGhost} onClick={sendTest} disabled={testing || !phone.trim()}>
                {testing ? "Sending…" : "Send test"}
              </button>
            </div>
            {testMsg && <div style={{ fontSize: 12, color: testMsg.includes("check your phone") ? "#15803d" : "#92400e", marginTop: 4 }}>{testMsg}</div>}
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

        <label style={C.label}>Subjects I'm certified to teach</label>
        <TagPicker options={SUBJECT_OPTIONS} value={quals} onChange={setQuals} placeholder="add a subject…" />

        <label style={{ ...C.label, marginTop: 14 }}>Grades I'm comfortable with</label>
        <TagPicker options={GRADE_OPTIONS} value={gradeComfort} onChange={setGradeComfort} placeholder="add a grade…" />

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
