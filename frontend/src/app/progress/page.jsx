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

export default function ProgressPage() {
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState(null);
  const [view, setView] = useState("login"); // login | register | forgot | reset | dashboard
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [student, setStudent] = useState(null);
  const [results, setResults] = useState([]);
  const [overallAvg, setOverallAvg] = useState(null);

  // Form fields
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [parentEmails, setParentEmails] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileEmail, setProfileEmail] = useState("");
  const [profileParentEmails, setProfileParentEmails] = useState("");

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      setView("dashboard");
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

  // Load results when dashboard is shown
  useEffect(() => {
    if (view !== "dashboard" || !token) return;
    setLoading(true);
    apiCall("/results", { auth: true })
      .then((data) => {
        if (data.error) {
          setError(data.error);
          if (data.error.includes("expired") || data.error.includes("authenticated")) {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setView("login");
          }
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
    setLoading(true);
    const data = await apiCall("/login", { method: "POST", body: { studentId, password } });
    if (data.ok) {
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setStudent(data.student);
      setView("dashboard");
    } else {
      setError(data.error || "Login failed.");
    }
    setLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const data = await apiCall("/register", {
      method: "POST",
      body: { studentId, password, email, parentEmails },
    });
    if (data.ok) {
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setStudent(data.student);
      setView("dashboard");
    } else {
      setError(data.error || "Registration failed.");
    }
    setLoading(false);
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const data = await apiCall("/forgot-password", { method: "POST", body: { studentId } });
    if (data.ok) {
      setView("reset");
      setError("");
    } else {
      setError(data.error || "Failed.");
    }
    setLoading(false);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const data = await apiCall("/reset-password", {
      method: "POST",
      body: { studentId, code: resetCode, newPassword },
    });
    if (data.ok) {
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setView("dashboard");
    } else {
      setError(data.error || "Reset failed.");
    }
    setLoading(false);
  };

  const handleSaveProfile = async () => {
    const data = await apiCall("/profile", {
      method: "PUT",
      auth: true,
      body: { email: profileEmail, parentEmails: profileParentEmails },
    });
    if (data.ok) setEditingProfile(false);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setStudent(null);
    setResults([]);
    setView("login");
  };

  if (!mounted) return null;

  const s = {
    page: { minHeight: "100vh", background: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)", padding: "40px 16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    card: { maxWidth: 480, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "32px 28px" },
    wideCard: { maxWidth: 700, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "32px 28px" },
    h1: { fontSize: 28, fontWeight: 800, color: "#1e293b", margin: 0, textAlign: "center" },
    h2: { fontSize: 20, fontWeight: 700, color: "#334155", margin: "24px 0 12px" },
    sub: { fontSize: 14, color: "#64748b", textAlign: "center", marginTop: 4, marginBottom: 20 },
    input: { width: "100%", padding: "10px 14px", fontSize: 15, border: "1px solid #e2e8f0", borderRadius: 10, outline: "none", boxSizing: "border-box", marginBottom: 12 },
    btn: { width: "100%", padding: "12px", fontSize: 15, fontWeight: 700, color: "#fff", background: "#2563eb", border: "none", borderRadius: 10, cursor: "pointer" },
    link: { fontSize: 13, color: "#2563eb", cursor: "pointer", background: "none", border: "none", textDecoration: "underline", padding: 0 },
    err: { background: "#fef2f2", color: "#dc2626", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 },
    tabs: { display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #e2e8f0" },
    tab: (active) => ({ flex: 1, padding: "10px", textAlign: "center", fontWeight: 700, fontSize: 14, cursor: "pointer", border: "none", background: "none", color: active ? "#2563eb" : "#94a3b8", borderBottom: active ? "2px solid #2563eb" : "2px solid transparent", marginBottom: -2 }),
    avgCard: { background: "linear-gradient(135deg, #2563eb, #7c3aed)", borderRadius: 14, padding: "20px 24px", color: "#fff", textAlign: "center", marginBottom: 20 },
    resultRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f1f5f9" },
  };

  // --- AUTH VIEWS ---
  if (view === "login" || view === "register") {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.h1}>Student Progress</h1>
          <div style={s.sub}>View your grading results and track your progress</div>

          <div style={s.tabs}>
            <button style={s.tab(view === "login")} onClick={() => { setView("login"); setError(""); }}>Login</button>
            <button style={s.tab(view === "register")} onClick={() => { setView("register"); setError(""); }}>Register</button>
          </div>

          {error && <div style={s.err}>{error}</div>}

          {view === "login" ? (
            <form onSubmit={handleLogin}>
              <input style={s.input} placeholder="Student ID (last 4 digits or full)" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
              <input style={s.input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button style={s.btn} type="submit" disabled={loading}>{loading ? "Logging in..." : "Login"}</button>
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button type="button" style={s.link} onClick={() => { setView("forgot"); setError(""); }}>Forgot password?</button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <input style={s.input} placeholder="Student ID (last 4 digits or full)" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
              <input style={s.input} type="password" placeholder="Choose a password (min 4 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
              <input style={s.input} type="email" placeholder="Your email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input style={s.input} placeholder="Parent email(s), comma-separated (optional)" value={parentEmails} onChange={(e) => setParentEmails(e.target.value)} />
              <button style={s.btn} type="submit" disabled={loading}>{loading ? "Creating account..." : "Register"}</button>
            </form>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#94a3b8" }}>
          curriculate.net
        </div>
      </div>
    );
  }

  if (view === "forgot") {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.h1}>Reset Password</h1>
          <div style={s.sub}>Enter your Student ID to receive a reset code</div>
          {error && <div style={s.err}>{error}</div>}
          <form onSubmit={handleForgot}>
            <input style={s.input} placeholder="Student ID" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
            <button style={s.btn} type="submit" disabled={loading}>{loading ? "Sending..." : "Send Reset Code"}</button>
          </form>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" style={s.link} onClick={() => setView("login")}>Back to login</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "reset") {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.h1}>Enter Reset Code</h1>
          <div style={s.sub}>Check your email for a 6-digit code</div>
          {error && <div style={s.err}>{error}</div>}
          <form onSubmit={handleReset}>
            <input style={s.input} placeholder="6-digit code" value={resetCode} onChange={(e) => setResetCode(e.target.value)} />
            <input style={s.input} type="password" placeholder="New password (min 4 chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button style={s.btn} type="submit" disabled={loading}>{loading ? "Resetting..." : "Reset Password"}</button>
          </form>
        </div>
      </div>
    );
  }

  // --- DASHBOARD ---
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
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{student.className}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => {
                setEditingProfile(!editingProfile);
                if (!editingProfile) {
                  apiCall("/profile", { auth: true }).then((d) => {
                    if (d.ok) {
                      setProfileEmail(d.email || "");
                      setProfileParentEmails((d.parentEmails || []).join(", "));
                    }
                  });
                }
              }}
              style={{ ...s.link, fontSize: 12 }}
              type="button"
            >
              Settings
            </button>
            <button onClick={logout} style={{ ...s.link, fontSize: 12, color: "#dc2626" }} type="button">Logout</button>
          </div>
        </div>

        {/* Settings panel */}
        {editingProfile && (
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#334155" }}>Settings</div>
            <input
              style={{ ...s.input, marginBottom: 8 }}
              placeholder="Your email"
              value={profileEmail}
              onChange={(e) => setProfileEmail(e.target.value)}
            />
            <input
              style={{ ...s.input, marginBottom: 8 }}
              placeholder="Parent email(s), comma-separated"
              value={profileParentEmails}
              onChange={(e) => setProfileParentEmails(e.target.value)}
            />
            <button
              onClick={handleSaveProfile}
              style={{ ...s.btn, width: "auto", padding: "8px 20px", fontSize: 13 }}
              type="button"
            >
              Save
            </button>
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
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>{results.length} assignment{results.length !== 1 ? "s" : ""} graded</div>
              </div>
            )}

            {/* Progress chart (simple bar visualization) */}
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
            <h2 style={s.h2}>Results</h2>
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
