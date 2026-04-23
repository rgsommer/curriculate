"use client";
import React, { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "";
const TOKEN_KEY = "curriculate_student_token";

function letterGrade(pct) {
  if (pct >= 93) return "A";
  if (pct >= 90) return "A-";
  if (pct >= 87) return "B+";
  if (pct >= 83) return "B";
  if (pct >= 80) return "B-";
  if (pct >= 77) return "C+";
  if (pct >= 73) return "C";
  if (pct >= 70) return "C-";
  if (pct >= 67) return "D+";
  if (pct >= 63) return "D";
  if (pct >= 60) return "D-";
  return "F";
}

function gradeColor(letter) {
  const l = (letter || "?")[0];
  if (l === "A") return "#16a34a";
  if (l === "B") return "#2563eb";
  if (l === "C") return "#d97706";
  if (l === "D") return "#dc2626";
  if (l === "F") return "#dc2626";
  return "#6b7280";
}

function RecommendWidget() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [recEmail, setRecEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) return <div style={{ textAlign: "center", color: "#16a34a", fontSize: 13, padding: 12 }}>Recommendation sent! Thanks for spreading the word.</div>;

  return (
    <div style={{ textAlign: "center", marginTop: 16 }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{ fontSize: 13, color: "#d97706", background: "none", border: "1px solid #d97706", borderRadius: 10, padding: "6px 16px", cursor: "pointer", fontWeight: 700 }}
        >
          Recommend Curriculate to a teacher
        </button>
      ) : (
        <div style={{ maxWidth: 360, margin: "0 auto", textAlign: "left" }}>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, boxSizing: "border-box" }} />
          <input placeholder="Teacher's email" type="email" value={recEmail} onChange={(e) => setRecEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={sending || !name.trim() || !recEmail.includes("@")}
              onClick={async () => {
                setSending(true);
                try {
                  const res = await fetch(`${API}/api/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommenderName: name, teacherEmail: recEmail }) });
                  const d = await res.json();
                  if (d.ok) setSent(true);
                } catch {}
                setSending(false);
              }}
              style={{ flex: 1, padding: "8px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#d97706", border: "none", borderRadius: 8, cursor: "pointer", opacity: sending ? 0.5 : 1 }}
            >
              {sending ? "Sending..." : "Send"}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: "8px 12px", fontSize: 13, color: "#64748b", background: "none", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProgressPage() {
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState(null);
  const [view, setView] = useState("login"); // login | dashboard | teacherCode | teacher
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [student, setStudent] = useState(null);
  const [results, setResults] = useState([]);
  const [overallAvg, setOverallAvg] = useState(null);

  // Login form
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [magicCode, setMagicCode] = useState("");
  const [teacherStudents, setTeacherStudents] = useState([]);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [profileEmails, setProfileEmails] = useState([]);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      // Decode JWT payload to determine token type
      try {
        const payload = JSON.parse(atob(saved.split(".")[1]));
        if (payload.type === "teacher-progress") {
          setToken(saved);
          setEmail(payload.teacherEmail || "");
          setView("teacher");
        } else {
          setToken(saved);
          setView("dashboard");
        }
      } catch {
        setToken(saved);
        setView("dashboard");
      }
    }
  }, []);

  const apiCall = useCallback(async (path, opts = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (opts.auth && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}/student-progress${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
  }, [token]);

  // Load teacher students when teacher view is shown
  useEffect(() => {
    if (view !== "teacher" || !token) return;
    setLoading(true);
    fetch(`${API}/student-progress/teacher/students`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          if (data.error.includes("expired") || data.error.includes("authenticated")) {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setView("login");
          }
          setError(data.error);
        } else {
          setTeacherStudents(data.students || []);
        }
        setLoading(false);
      })
      .catch(() => { setLoading(false); setError("Failed to load class overview."); });
  }, [view, token]);

  // Load results when dashboard is shown
  useEffect(() => {
    if (view !== "dashboard" || !token) return;
    setLoading(true);
    apiCall("/results", { auth: true })
      .then((data) => {
        if (data.error) {
          if (data.error.includes("expired") || data.error.includes("authenticated")) {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setView("login");
          }
          setError(data.error);
        } else {
          setStudent(data.student);
          setResults(data.results || []);
          setOverallAvg(data.overallAvg);
        }
        setLoading(false);
      })
      .catch(() => { setLoading(false); setError("Failed to load results."); });
  }, [view, token, apiCall]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const body = { studentId: studentId.trim(), email };
    if (magicCode) body.magicCode = magicCode;
    const data = await apiCall("/login", { method: "POST", body });
    if (data.ok) {
      if (data.needsCode) {
        // Teacher flow: code sent to email
        setView("teacherCode");
        setInfo(data.message);
      } else if (data.isTeacherOverview) {
        // Teacher class overview
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setTeacherStudents(data.students || []);
        setView("teacher");
      } else {
        // Student/parent flow
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setStudent(data.student);
        if (data.newEmailAdded) {
          setInfo(`Your email was added. ${data.emailCount} email${data.emailCount > 1 ? "s" : ""} now receive notifications for this student.`);
        }
        setView("dashboard");
      }
    } else {
      setError(data.error || "Login failed.");
    }
    setLoading(false);
  };

  const handleMagicCode = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const data = await apiCall("/login", { method: "POST", body: { email, magicCode } });
    if (data.ok && data.isTeacherOverview) {
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setTeacherStudents(data.students || []);
      setView("teacher");
    } else {
      setError(data.error || "Invalid code.");
    }
    setLoading(false);
  };

  const loadProfile = async () => {
    const data = await apiCall("/profile", { auth: true });
    if (data.ok) setProfileEmails(data.emails || []);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setStudent(null);
    setResults([]);
    setOverallAvg(null);
    setView("login");
    setInfo("");
    setError("");
  };

  if (!mounted) return null;

  const s = {
    page: { minHeight: "100vh", background: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)", padding: "40px 16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    card: { maxWidth: 440, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "32px 28px" },
    wideCard: { maxWidth: 700, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "32px 28px" },
    h1: { fontSize: 28, fontWeight: 800, color: "#1e293b", margin: 0, textAlign: "center" },
    sub: { fontSize: 14, color: "#64748b", textAlign: "center", marginTop: 4, marginBottom: 20 },
    input: { width: "100%", padding: "10px 14px", fontSize: 15, border: "1px solid #e2e8f0", borderRadius: 10, outline: "none", boxSizing: "border-box", marginBottom: 12 },
    btn: { width: "100%", padding: "12px", fontSize: 15, fontWeight: 700, color: "#fff", background: "#2563eb", border: "none", borderRadius: 10, cursor: "pointer" },
    link: { fontSize: 13, color: "#2563eb", cursor: "pointer", background: "none", border: "none", textDecoration: "underline", padding: 0 },
    err: { background: "#fef2f2", color: "#dc2626", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 },
    info: { background: "#f0fdf4", color: "#16a34a", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 },
    avgCard: { background: "linear-gradient(135deg, #2563eb, #7c3aed)", borderRadius: 14, padding: "20px 24px", color: "#fff", textAlign: "center", marginBottom: 20 },
    resultRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f1f5f9" },
  };

  // --- LOGIN ---
  if (view === "login") {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.h1}>Student Progress</h1>
          <div style={s.sub}>Students and parents — enter your student ID and email to view grades and feedback</div>

          {error && <div style={s.err}>{error}</div>}

          <form onSubmit={handleLogin}>
            <input
              style={s.input}
              placeholder="Student ID (last 4 digits or full)"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            />
            <input
              style={s.input}
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? "Loading..." : "View Progress"}
            </button>
          </form>

          <div style={{ marginTop: 16, fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
            <strong>Students &amp; parents:</strong> Enter your student ID and email. First time? Your account is created automatically.
            Multiple people can each add their own email to receive notifications.
            <br /><br />
            <strong>Teachers:</strong> Leave the student ID blank and enter your email to see all your students.
          </div>
        </div>
        <RecommendWidget />
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          curriculate.net/progress
        </div>
      </div>
    );
  }

  // --- TEACHER: ENTER MAGIC CODE ---
  if (view === "teacherCode") {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.h1}>Teacher Verification</h1>
          <div style={s.sub}>Enter the 6-digit code sent to {email}</div>
          {info && <div style={s.info}>{info}</div>}
          {error && <div style={s.err}>{error}</div>}
          <form onSubmit={handleMagicCode}>
            <input style={{ ...s.input, fontSize: 24, textAlign: "center", letterSpacing: 8 }} placeholder="000000" maxLength={6} value={magicCode} onChange={(e) => setMagicCode(e.target.value)} />
            <button style={s.btn} type="submit" disabled={loading}>{loading ? "Verifying..." : "Verify"}</button>
          </form>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" style={s.link} onClick={() => { setView("login"); setError(""); setMagicCode(""); }}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  // --- TEACHER CLASS OVERVIEW ---
  if (view === "teacher") {
    return (
      <div style={s.page}>
        <div style={s.wideCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h1 style={{ ...s.h1, textAlign: "left", fontSize: 24 }}>Class Progress</h1>
            <button onClick={logout} style={{ ...s.link, fontSize: 12, color: "#dc2626" }} type="button">Logout</button>
          </div>

          {error && <div style={s.err}>{error}</div>}

          <div style={{ ...s.avgCard, background: "linear-gradient(135deg, #0f766e, #2563eb)" }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{teacherStudents.length} students with graded work</div>
          </div>

          {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading class data...</div>}

          {/* Student list */}
          <div style={{ fontSize: 11, color: "#94a3b8", padding: "8px 0", borderBottom: "2px solid #e2e8f0", display: "flex", fontWeight: 700 }}>
            <div style={{ flex: 2 }}>STUDENT</div>
            <div style={{ flex: 1, textAlign: "center" }}>CLASS</div>
            <div style={{ flex: 1, textAlign: "center" }}>ASSIGNMENTS</div>
            <div style={{ flex: 1, textAlign: "center" }}>AVERAGE</div>
          </div>
          {teacherStudents.map((ts) => (
            <div
              key={ts.studentId}
              style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
              onClick={() => {
                // Switch to student view
                setStudentId(ts.studentId);
                setEmail(email); // keep teacher email
                // Trigger login for this student
                apiCall("/login", { method: "POST", body: { studentId: ts.studentId, email } })
                  .then((data) => {
                    if (data.ok && !data.needsCode && !data.isTeacherOverview) {
                      localStorage.setItem(TOKEN_KEY, data.token);
                      setToken(data.token);
                      setStudent(data.student);
                      setView("dashboard");
                    }
                  });
              }}
            >
              <div style={{ flex: 2, fontWeight: 700, fontSize: 14 }}>{ts.firstName} {ts.lastName}</div>
              <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#64748b" }}>{ts.className}</div>
              <div style={{ flex: 1, textAlign: "center", fontSize: 13 }}>{ts.totalAssignments}</div>
              <div style={{ flex: 1, textAlign: "center" }}>
                {ts.avg != null ? (
                  <span style={{ fontWeight: 800, color: gradeColor(letterGrade(ts.avg)) }}>{ts.avg}% {letterGrade(ts.avg)}</span>
                ) : (
                  <span style={{ color: "#94a3b8" }}>--</span>
                )}
              </div>
            </div>
          ))}

          {teacherStudents.length === 0 && (
            <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 }}>
              No graded results found yet. Results will appear after you grade student work with rosters uploaded.
            </div>
          )}
        </div>
        <RecommendWidget />
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          curriculate.net/progress
        </div>
      </div>
    );
  }

  // --- STUDENT DASHBOARD ---
  return (
    <div style={s.page}>
      <div style={s.wideCard}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ ...s.h1, textAlign: "left", fontSize: 24 }}>
              {student ? `${student.firstName} ${student.lastName}` : "My Progress"}
            </h1>
            {student?.className && (
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                {student.className}
                {student.emailCount > 1 && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8" }}>
                    {student.emailCount} people notified
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => { setShowSettings(!showSettings); if (!showSettings) loadProfile(); }}
              style={{ ...s.link, fontSize: 12 }}
              type="button"
            >
              Settings
            </button>
            <button onClick={logout} style={{ ...s.link, fontSize: 12, color: "#dc2626" }} type="button">Logout</button>
          </div>
        </div>

        {info && <div style={s.info}>{info}</div>}
        {error && <div style={s.err}>{error}</div>}

        {/* Settings panel */}
        {showSettings && (
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#334155" }}>
              Email notifications
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
              Everyone on this list gets notified when new grades arrive. To add someone, they just log in with the student ID and their email.
            </div>
            {profileEmails.map((em, i) => (
              <div key={em} style={{ padding: "6px 0", borderBottom: "1px solid #e2e8f0", fontSize: 13 }}>
                {em}
                {i === 0 && <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 8 }}>(original)</span>}
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
              To add someone, they log in at curriculate.net/progress with the student ID and their email.
              To remove someone, ask your teacher.
            </div>
          </div>
        )}

        {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading...</div>}

        {!loading && (
          <>
            {/* Overall average */}
            {overallAvg != null && (
              <div style={s.avgCard}>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Overall Average</div>
                <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1 }}>{overallAvg}%</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{letterGrade(overallAvg)}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                  {results.length} assignment{results.length !== 1 ? "s" : ""} graded
                </div>
              </div>
            )}

            {/* Progress chart */}
            {results.length > 1 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Progress Over Time</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60 }}>
                  {[...results].reverse().map((r, i) => {
                    const pct = r.pct || 0;
                    return (
                      <div
                        key={i}
                        title={`${r.title || r.subject}: ${pct}%`}
                        style={{
                          flex: 1,
                          height: `${Math.max(pct * 0.6, 3)}px`,
                          background: pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444",
                          borderRadius: "3px 3px 0 0",
                          cursor: "pointer",
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                  <span>Oldest</span>
                  <span>Most recent</span>
                </div>
              </div>
            )}

            {/* Results list */}
            <div style={{ fontSize: 16, fontWeight: 700, color: "#334155", marginBottom: 8, marginTop: 20 }}>Results</div>
            {results.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 }}>
                No grading results yet. Results will appear here after your teacher grades your work.
              </div>
            )}
            {results.map((r) => (
              <div key={r.code} style={s.resultRow}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>
                    {r.title || r.subject || "Assignment"}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    {r.subject && <span>{r.subject} &middot; </span>}
                    {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ textAlign: "right", marginRight: 12 }}>
                  {r.pct != null ? (
                    <>
                      <div style={{ fontWeight: 800, fontSize: 16, color: gradeColor(letterGrade(r.pct)) }}>
                        {letterGrade(r.pct)}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{r.score}/{r.outOf} ({r.pct}%)</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 14, color: "#94a3b8" }}>--</div>
                  )}
                </div>
                <a
                  href={`/results/${r.code}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 11, fontWeight: 700, color: "#2563eb",
                    textDecoration: "none", background: "#eff6ff",
                    padding: "6px 10px", borderRadius: 8,
                  }}
                >
                  {r.code}
                </a>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#94a3b8" }}>
        curriculate.net/progress
      </div>
    </div>
  );
}
