"use client";
import React, { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "";
const TOKEN_KEY = "curriculate_student_token";
const TEACHER_TOKEN_KEY = "curriculate_teacher_token";

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

// Soft subject color palette — pastel tints for subject bars
const SUBJECT_COLORS = [
  { bg: "linear-gradient(135deg, #dbeafe, #eff6ff)", border: "#bfdbfe", text: "#1e40af" },  // blue
  { bg: "linear-gradient(135deg, #fce7f3, #fdf2f8)", border: "#fbcfe8", text: "#9d174d" },  // pink
  { bg: "linear-gradient(135deg, #d1fae5, #ecfdf5)", border: "#a7f3d0", text: "#065f46" },  // green
  { bg: "linear-gradient(135deg, #fef3c7, #fffbeb)", border: "#fde68a", text: "#92400e" },  // amber
  { bg: "linear-gradient(135deg, #e0e7ff, #eef2ff)", border: "#c7d2fe", text: "#3730a3" },  // indigo
  { bg: "linear-gradient(135deg, #ffe4e6, #fff1f2)", border: "#fecdd3", text: "#9f1239" },  // rose
  { bg: "linear-gradient(135deg, #ccfbf1, #f0fdfa)", border: "#99f6e4", text: "#115e59" },  // teal
  { bg: "linear-gradient(135deg, #fae8ff, #fdf4ff)", border: "#f0abfc", text: "#6b21a8" },  // purple
  { bg: "linear-gradient(135deg, #ffedd5, #fff7ed)", border: "#fed7aa", text: "#9a3412" },  // orange
  { bg: "linear-gradient(135deg, #cffafe, #ecfeff)", border: "#a5f3fc", text: "#155e75" },  // cyan
];

// Extract subject prefix from class codes like "GEO8A" → "geo",
// "MATH7B" → "math", "HIST7C" → "hist", "CED8A" → "ced"
function subjectPrefix(name) {
  const s = (name || "").toLowerCase().trim();
  // Strip trailing digits + optional section letter (e.g. "geo8a" → "geo", "math7b" → "math")
  return s.replace(/\d+[a-z]?$/, "");
}

// Build a collision-free color map: deduplicate by subject prefix, sort,
// then assign colors round-robin so no two subject areas share a color.
function buildSubjectColorMap(allNames) {
  const prefixes = [...new Set(allNames.map(subjectPrefix).filter(Boolean))].sort();
  const map = {};
  prefixes.forEach((p, i) => { map[p] = SUBJECT_COLORS[i % SUBJECT_COLORS.length]; });
  return map;
}

function subjectColor(subj, colorMap) {
  const prefix = subjectPrefix(subj) || (subj || "").toLowerCase().trim();
  if (colorMap && colorMap[prefix]) return colorMap[prefix];
  // Fallback for subjects not in the map
  return SUBJECT_COLORS[0];
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

function RecommendWidget({ userEmail, authToken, isTeacher }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [myEmail, setMyEmail] = useState(userEmail || "");
  const [teacherName, setTeacherName] = useState("");
  const [recEmail, setRecEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Auto-dismiss confirmation after 3 seconds, then show "Recommend another" button
  useEffect(() => {
    if (!sent) return;
    setShowConfirm(true);
    const t = setTimeout(() => setShowConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [sent]);

  if (sent && !showConfirm) return (
    <div style={{ textAlign: "center", marginTop: 16 }}>
      <button
        onClick={() => { setSent(false); setTeacherName(""); setRecEmail(""); setOpen(true); }}
        style={{ fontSize: 13, color: "#d97706", background: "none", border: "1px solid #d97706", borderRadius: 10, padding: "6px 16px", cursor: "pointer", fontWeight: 700 }}
      >
        Recommend another teacher
      </button>
    </div>
  );

  if (sent && showConfirm) return (
    <div style={{ textAlign: "center", padding: 12 }}>
      <div style={{ color: "#16a34a", fontSize: 13 }}>Recommendation sent! Thanks for spreading the word.</div>
    </div>
  );

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
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>About you</div>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, boxSizing: "border-box" }} />
          {!userEmail && (
            <input placeholder="Your email (optional — earns a free month)" type="email" value={myEmail} onChange={(e) => setMyEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, boxSizing: "border-box" }} />
          )}
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4, marginTop: 4 }}>Teacher to recommend</div>
          <input placeholder="Teacher's name" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, boxSizing: "border-box" }} />
          <input placeholder="Teacher's email" type="email" value={recEmail} onChange={(e) => setRecEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={sending || !name.trim() || !recEmail.includes("@")}
              onClick={async () => {
                setSending(true);
                try {
                  const res = await fetch(`${API}/api/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommenderName: name, recommenderEmail: myEmail, teacherName, teacherEmail: recEmail }) });
                  const d = await res.json();
                  if (d.ok) {
                    setSent(true);
                    // If student/parent entered a new email, add it to their account
                    if (!isTeacher && !userEmail && myEmail.includes("@") && authToken) {
                      try {
                        await fetch(`${API}/student-progress/profile/add-email`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                          body: JSON.stringify({ email: myEmail }),
                        });
                      } catch {}
                    }
                  }
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
  const [rosterStudents, setRosterStudents] = useState([]); // full roster for reassignment

  // Teacher → student drill-down (for back button)
  const [teacherToken, setTeacherToken] = useState(null);

  // Expandable year/subject sections (student dashboard)
  const [expandedYears, setExpandedYears] = useState({});
  const [expandedSubjects, setExpandedSubjects] = useState({});
  // Inline title editing (teacher only)
  const [editingTitleCode, setEditingTitleCode] = useState(null);
  const [reassigningCode, setReassigningCode] = useState(null); // result code being reassigned to another student
  // Expandable class sections (teacher overview)
  const [expandedClasses, setExpandedClasses] = useState({});
  // Teacher's class names for re-classify dropdown
  const [teacherClassNames, setTeacherClassNames] = useState([]);
  // Bulk rename / delete
  const [showBulkRename, setShowBulkRename] = useState(false);
  const [bulkOld, setBulkOld] = useState("");
  const [bulkNew, setBulkNew] = useState("");
  const [bulkRenaming, setBulkRenaming] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleteTitle, setBulkDeleteTitle] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deduping, setDeduping] = useState(false);

  // Expanded result details (KITA bars)
  const [expandedResult, setExpandedResult] = useState(null);

  // Denominator editor (teacher view)
  const [editingDenomCode, setEditingDenomCode] = useState(null); // result code being edited
  const [denomInput, setDenomInput] = useState("");

  // Recommendation badge
  const [recommendCount, setRecommendCount] = useState(0);

  // Email-reach stats (teacher overview): how many of the teacher's
  // students have entered an email AND how many have actually used
  // the portal at least once.  Populated from the /teacher/students
  // response.
  const [emailStats, setEmailStats] = useState(null);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [profileEmails, setProfileEmails] = useState([]);
  const [emailPrefs, setEmailPrefs] = useState([]); // [{ address, notify }]
  const [updatingPref, setUpdatingPref] = useState(null); // email being updated

  useEffect(() => {
    setMounted(true);
    // Restore teacher token if we're in a drill-down
    const savedTeacher = localStorage.getItem(TEACHER_TOKEN_KEY);
    if (savedTeacher) setTeacherToken(savedTeacher);

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
          if (data.rosterStudents) setRosterStudents(data.rosterStudents);
          if (data.classNames) setTeacherClassNames(data.classNames);
          if (data.emailStats) setEmailStats(data.emailStats);
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

    // Fetch recommendation badge count (skip when teacher is viewing a student)
    if (email && email.includes("@") && !teacherToken) {
      fetch(`${API}/api/recommend/count?email=${encodeURIComponent(email)}`)
        .then((r) => r.json())
        .then((d) => { if (d.ok) setRecommendCount(d.count); })
        .catch(() => {});
    } else {
      setRecommendCount(0);
    }

    // If teacher is viewing a student dashboard, load class names & roster
    // (needed for class dropdown + reassign — lost on page reload)
    const savedTeacherTk = localStorage.getItem(TEACHER_TOKEN_KEY);
    if (savedTeacherTk && teacherClassNames.length === 0) {
      fetch(`${API}/student-progress/teacher/students`, {
        headers: { Authorization: `Bearer ${savedTeacherTk}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.classNames) setTeacherClassNames(d.classNames);
          if (d.rosterStudents) setRosterStudents(d.rosterStudents);
        })
        .catch(() => {});
    }
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
        if (data.rosterStudents) setRosterStudents(data.rosterStudents);
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
      if (data.rosterStudents) setRosterStudents(data.rosterStudents);
      setInfo("");
      setView("teacher");
    } else {
      setError(data.error || "Invalid code.");
    }
    setLoading(false);
  };

  const loadProfile = async () => {
    const data = await apiCall("/profile", { auth: true });
    if (data.ok) {
      setProfileEmails(data.emails || []);
      setEmailPrefs(data.emailPrefs || []);
    }
  };

  const updateEmailPref = async (email, notify) => {
    setUpdatingPref(email);
    const data = await apiCall("/profile/email-pref", {
      method: "PATCH",
      auth: true,
      body: { email, notify },
    });
    if (data.ok) {
      setEmailPrefs((prev) =>
        prev.map((ep) => (ep.address === email ? { ...ep, notify } : ep))
      );
    }
    setUpdatingPref(null);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TEACHER_TOKEN_KEY);
    setToken(null);
    setTeacherToken(null);
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
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <img src="/images/pulse/pulse-logo.png" alt="Curriculate Pulse" style={{ height: 64, width: "auto" }} />
          </div>
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
        <RecommendWidget userEmail={email} authToken={token} isTeacher={view === "teacher"} />
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/images/pulse/pulse-icon.png" alt="Pulse" style={{ height: 28, width: "auto" }} />
              <h1 style={{ ...s.h1, textAlign: "left", fontSize: 24, margin: 0 }}>Class Progress</h1>
            </div>
            <button onClick={logout} style={{ ...s.link, fontSize: 12, color: "#dc2626" }} type="button">Logout</button>
          </div>

          {error && <div style={s.err}>{error}</div>}

          <div style={{ ...s.avgCard, background: "linear-gradient(135deg, #0f766e, #2563eb)" }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{teacherStudents.length} students with graded work</div>
          </div>

          {/* Email-reach banner: how many students are linked to an
              email and have actually viewed their results via the
              progress portal.  Hidden when there's nothing to show
              (no students yet OR backend didn't include emailStats). */}
          {emailStats && emailStats.totalStudents > 0 && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 16px",
                borderRadius: 14,
                border: "1px solid #bae6fd",
                background: "linear-gradient(135deg, #eff6ff, #f0f9ff)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0c4a6e", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  📬 Email on file
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#0c4a6e", lineHeight: 1.15 }}>
                  {emailStats.withEmail}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0369a1", marginLeft: 4 }}>
                    / {emailStats.totalStudents}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#0369a1" }}>
                  {emailStats.withEmailPct}% of class
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#14532d", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  ✅ Viewing results
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#14532d", lineHeight: 1.15 }}>
                  {emailStats.verified}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginLeft: 4 }}>
                    / {emailStats.totalStudents}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#16a34a" }}>
                  {emailStats.verifiedPct}% logged in at least once
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#78350f", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  ⏳ Not yet reached
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#78350f", lineHeight: 1.15 }}>
                  {Math.max(0, emailStats.totalStudents - emailStats.withEmail)}
                </div>
                <div style={{ fontSize: 11, color: "#b45309" }}>
                  students still need an email
                </div>
              </div>
            </div>
          )}

          {/* Bulk tools */}
          <div style={{ textAlign: "right", marginBottom: 8, display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button
              onClick={() => { setShowBulkRename(!showBulkRename); setShowBulkDelete(false); }}
              style={{ fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              {showBulkRename ? "Close rename" : "Rename assignments"}
            </button>
            <button
              onClick={() => { setShowBulkDelete(!showBulkDelete); setShowBulkRename(false); }}
              style={{ fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              {showBulkDelete ? "Close delete" : "Delete assignments"}
            </button>
            <button
              disabled={deduping}
              onClick={async () => {
                if (!confirm("Remove duplicate results from batch-graded PDFs? When the same PDF was graded multiple times, this keeps only the most recent result per student. Single-photo results are not affected. This cannot be undone.")) return;
                setDeduping(true);
                try {
                  const r = await fetch(`${API}/student-progress/teacher/dedup`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  });
                  const data = await r.json();
                  if (data.ok) {
                    if (data.removed > 0) {
                      setInfo(`Removed ${data.removed} duplicate${data.removed !== 1 ? "s" : ""} across ${data.groups} assignment${data.groups !== 1 ? "s" : ""}.`);
                      // Refresh teacher data
                      try {
                        const r2 = await fetch(`${API}/student-progress/teacher/students`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        const d2 = await r2.json();
                        if (d2.students) setTeacherStudents(d2.students);
                        if (d2.rosterStudents) setRosterStudents(d2.rosterStudents);
                        if (d2.classNames) setTeacherClassNames(d2.classNames);
                      } catch {}
                    } else {
                      setInfo("No duplicates found.");
                    }
                    setTimeout(() => setInfo(""), 4000);
                  } else {
                    setError(data.error || "Failed to remove duplicates.");
                  }
                } catch {
                  setError("Failed to remove duplicates.");
                }
                setDeduping(false);
              }}
              style={{ fontSize: 12, color: "#9333ea", background: "none", border: "none", cursor: deduping ? "default" : "pointer", textDecoration: "underline", opacity: deduping ? 0.5 : 1 }}
            >
              {deduping ? "Removing..." : "Remove duplicates"}
            </button>
          </div>
          {showBulkRename && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Bulk rename assignments</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                Rename all assignments with a given title across all students at once.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  placeholder='Current title (e.g. "Test")'
                  value={bulkOld}
                  onChange={(e) => setBulkOld(e.target.value)}
                  style={{ flex: 1, minWidth: 140, padding: "6px 10px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, outline: "none" }}
                />
                <span style={{ fontSize: 13, color: "#94a3b8" }}>→</span>
                <input
                  placeholder='New title (e.g. "Math Ch8 Test")'
                  value={bulkNew}
                  onChange={(e) => setBulkNew(e.target.value)}
                  style={{ flex: 1, minWidth: 140, padding: "6px 10px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, outline: "none" }}
                />
                <button
                  disabled={bulkRenaming || !bulkNew.trim()}
                  onClick={async () => {
                    setBulkRenaming(true);
                    try {
                      const res = await fetch(`${API}/student-progress/teacher/bulk-rename`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ oldTitle: bulkOld.trim(), newTitle: bulkNew.trim() }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setInfo(`Renamed ${data.updated} assignment${data.updated !== 1 ? "s" : ""}.`);
                        setBulkOld("");
                        setBulkNew("");
                        setShowBulkRename(false);
                        setTimeout(() => setInfo(""), 4000);
                      } else {
                        setError(data.error || "Failed to rename.");
                      }
                    } catch {
                      setError("Failed to rename.");
                    }
                    setBulkRenaming(false);
                  }}
                  style={{
                    padding: "6px 14px", fontSize: 13, fontWeight: 700, borderRadius: 6, border: "none",
                    background: bulkNew.trim() ? "#2563eb" : "#cbd5e1", color: "#fff", cursor: bulkNew.trim() ? "pointer" : "default",
                  }}
                >
                  {bulkRenaming ? "Renaming..." : "Rename all"}
                </button>
              </div>
            </div>
          )}
          {showBulkDelete && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>Bulk delete assignments</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                Delete all assignments with a given title across all your students. This cannot be undone.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  placeholder='Title to delete (e.g. "Test")'
                  value={bulkDeleteTitle}
                  onChange={(e) => setBulkDeleteTitle(e.target.value)}
                  style={{ flex: 1, minWidth: 180, padding: "6px 10px", fontSize: 13, border: "1px solid #fecaca", borderRadius: 6, outline: "none", background: "#fff" }}
                />
                <button
                  disabled={bulkDeleting || !bulkDeleteTitle.trim()}
                  onClick={async () => {
                    if (!confirm(`Delete ALL assignments titled "${bulkDeleteTitle.trim()}" for every student? This cannot be undone.`)) return;
                    setBulkDeleting(true);
                    try {
                      const res = await fetch(`${API}/student-progress/teacher/bulk-delete`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ title: bulkDeleteTitle.trim() }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setInfo(`Deleted ${data.deleted} assignment${data.deleted !== 1 ? "s" : ""}.`);
                        setBulkDeleteTitle("");
                        setShowBulkDelete(false);
                        setTimeout(() => setInfo(""), 4000);
                        // Refresh teacher data
                        try {
                          const r2 = await fetch(`${API}/student-progress/teacher/students`, {
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          const d2 = await r2.json();
                          if (d2.students) setTeacherStudents(d2.students);
                          if (d2.rosterStudents) setRosterStudents(d2.rosterStudents);
                          if (d2.classNames) setTeacherClassNames(d2.classNames);
                        } catch {}
                      } else {
                        setError(data.error || "Failed to delete.");
                      }
                    } catch {
                      setError("Failed to delete.");
                    }
                    setBulkDeleting(false);
                  }}
                  style={{
                    padding: "6px 14px", fontSize: 13, fontWeight: 700, borderRadius: 6, border: "none",
                    background: bulkDeleteTitle.trim() ? "#dc2626" : "#cbd5e1", color: "#fff", cursor: bulkDeleteTitle.trim() ? "pointer" : "default",
                  }}
                >
                  {bulkDeleting ? "Deleting..." : "Delete all"}
                </button>
              </div>
            </div>
          )}

          {info && <div style={s.info}>{info}</div>}
          {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading class data...</div>}

          {/* Collapse / Expand all */}
          {teacherClassNames.length > 1 && (
            <div style={{ textAlign: "right", marginBottom: 6 }}>
              <button
                onClick={() => {
                  const anyOpen = Object.values(expandedClasses).some((v) => v === true);
                  const next = {};
                  teacherClassNames.forEach((cn) => { next[cn] = !anyOpen; });
                  setExpandedClasses(next);
                }}
                style={{ fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                {Object.values(expandedClasses).some((v) => v === true) ? "Collapse all" : "Expand all"}
              </button>
            </div>
          )}

          {/* Student list grouped by class/subject */}
          {(() => {
            if (teacherStudents.length === 0) {
              return (
                <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 }}>
                  No graded results found yet. Results will appear after you grade student work with rosters uploaded.
                </div>
              );
            }

            // Group students by className
            const byClass = {};
            teacherStudents.forEach((ts) => {
              const cls = ts.className || "General";
              if (!byClass[cls]) byClass[cls] = [];
              byClass[cls].push(ts);
            });
            const classNames = Object.keys(byClass).sort();

            // Sort students within each class alphabetically
            classNames.forEach((cls) => {
              byClass[cls].sort((a, b) => {
                const nameA = (a.lastName || a.firstName || "").trim();
                const nameB = (b.lastName || b.firstName || "").trim();
                return nameA.localeCompare(nameB) || (a.firstName || "").localeCompare(b.firstName || "");
              });
            });

            // Student row renderer
            const StudentRow = ({ ts, showClass }) => (
              <div
                key={ts.studentId}
                style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (loading) return; // prevent double-click while loading
                  // Save the current teacher token before drilling down
                  // Read from localStorage as source of truth (state may be stale after back-navigation)
                  const currentToken = localStorage.getItem(TOKEN_KEY) || token;
                  setTeacherToken(currentToken);
                  localStorage.setItem(TEACHER_TOKEN_KEY, currentToken);
                  setStudentId(ts.studentId);
                  // Reset stale student state immediately
                  setStudent(null);
                  setResults([]);
                  setOverallAvg(null);
                  setExpandedResult(null);
                  setReassigningCode(null);
                  setInfo("");
                  setError("");
                  setLoading(true);
                  try {
                    // Use teacher email from state or decoded from stored token
                    let teacherEmail = email;
                    if (!teacherEmail || !teacherEmail.includes("@")) {
                      try {
                        const savedTk = localStorage.getItem(TOKEN_KEY);
                        if (savedTk) {
                          const payload = JSON.parse(atob(savedTk.split(".")[1]));
                          if (payload.teacherEmail) teacherEmail = payload.teacherEmail;
                        }
                      } catch {}
                    }
                    const res = await fetch(`${API}/student-progress/login`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ studentId: ts.studentId, email: teacherEmail }),
                    });
                    const data = await res.json();
                    if (data.ok && !data.needsCode && !data.isTeacherOverview) {
                      // Set student token BEFORE switching view so the dashboard
                      // useEffect picks up the correct token
                      localStorage.setItem(TOKEN_KEY, data.token);
                      setToken(data.token);
                      setStudent(data.student || { firstName: ts.firstName, lastName: ts.lastName, className: ts.className });
                      setView("dashboard");
                    } else {
                      console.warn("[StudentRow] unexpected response:", data);
                      setError(data.error || "Failed to load student.");
                    }
                  } catch (err) {
                    console.error("[StudentRow] login error:", err);
                    setError("Failed to load student. Please try again.");
                  }
                  setLoading(false);
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ flex: 2, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{ts.firstName} {ts.lastName}</span>
                  {/* Verified-email indicator:
                      ✅ green = email on file AND someone (student or
                      parent) has logged into the portal at least once
                      📬 blue  = email on file but never logged in
                      no badge = no email collected yet */}
                  {ts.emailVerified ? (
                    <span
                      title={`Verified — student${
                        ts.parentLoginCount > 0 ? " or parent" : ""
                      } logged in via email${
                        ts.lastLoginAt
                          ? " (last visit: " + new Date(ts.lastLoginAt).toLocaleDateString() + ")"
                          : ""
                      }`}
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "#dcfce7",
                        border: "1px solid #86efac",
                        color: "#15803d",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ✅ verified
                    </span>
                  ) : ts.hasEmail ? (
                    <span
                      title={`Email on file (${ts.emailCount}), but the portal hasn't been opened yet.`}
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "#dbeafe",
                        border: "1px solid #93c5fd",
                        color: "#1d4ed8",
                        whiteSpace: "nowrap",
                      }}
                    >
                      📬 invited
                    </span>
                  ) : (
                    <span
                      title="No email collected yet — student / parent will see results only via the printed reference code."
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        color: "#a16207",
                        whiteSpace: "nowrap",
                      }}
                    >
                      no email
                    </span>
                  )}
                </div>
                {showClass && <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#64748b" }}>{ts.className}</div>}
                <div style={{ flex: 1, textAlign: "center", fontSize: 13 }}>{ts.totalAssignments}</div>
                <div style={{ flex: 1, textAlign: "center" }}>
                  {ts.avg != null ? (
                    <span style={{ fontWeight: 800, color: gradeColor(letterGrade(ts.avg)) }}>{ts.avg}% {letterGrade(ts.avg)}</span>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>--</span>
                  )}
                </div>
              </div>
            );

            // Single class — flat list, no grouping needed
            if (classNames.length <= 1) {
              return (
                <>
                  <div style={{ fontSize: 11, color: "#94a3b8", padding: "8px 0", borderBottom: "2px solid #e2e8f0", display: "flex", fontWeight: 700 }}>
                    <div style={{ flex: 2 }}>STUDENT</div>
                    <div style={{ flex: 1, textAlign: "center" }}>ASSIGNMENTS</div>
                    <div style={{ flex: 1, textAlign: "center" }}>AVERAGE</div>
                  </div>
                  {byClass[classNames[0]].map((ts) => <StudentRow key={ts.studentId} ts={ts} showClass={false} />)}
                </>
              );
            }

            // Multiple classes — collapsible sections
            const classColorMap = buildSubjectColorMap(classNames);
            return classNames.map((cls) => {
              const students = byClass[cls];
              const classAvgs = students.filter((s) => s.avg != null).map((s) => s.avg);
              const classAvg = classAvgs.length ? Math.round(classAvgs.reduce((a, b) => a + b, 0) / classAvgs.length) : null;
              const isOpen = expandedClasses[cls] === true; // default collapsed
              const cc = subjectColor(cls, classColorMap);

              return (
                <div key={cls} style={{ marginBottom: 8 }}>
                  <button
                    onClick={() => setExpandedClasses((prev) => isOpen ? { ...prev, [cls]: false } : { [cls]: true })}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", background: cc.bg,
                      border: `1px solid ${cc.border}`, borderRadius: isOpen ? "10px 10px 0 0" : 10,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: cc.text, opacity: 0.6, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>&#9654;</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: cc.text }}>{cls}</span>
                      <span style={{ fontSize: 12, color: cc.text, opacity: 0.6 }}>{students.length} student{students.length !== 1 ? "s" : ""}</span>
                    </div>
                    {classAvg != null && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: gradeColor(letterGrade(classAvg)) }}>{classAvg}%</span>
                        <span style={{ fontWeight: 700, fontSize: 12, color: gradeColor(letterGrade(classAvg)) }}>{letterGrade(classAvg)}</span>
                      </div>
                    )}
                  </button>
                  {isOpen && (
                    <div style={{ border: "1px solid #e2e8f0", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                      {/* Column headers */}
                      <div style={{ fontSize: 11, color: "#94a3b8", padding: "6px 14px", display: "flex", fontWeight: 700, background: "#fafbfc" }}>
                        <div style={{ flex: 2 }}>STUDENT</div>
                        <div style={{ flex: 1, textAlign: "center" }}>ASSIGNMENTS</div>
                        <div style={{ flex: 1, textAlign: "center" }}>AVERAGE</div>
                      </div>
                      {students.map((ts) => <StudentRow key={ts.studentId} ts={ts} showClass={false} />)}
                    </div>
                  )}
                </div>
              );
            });
          })()}

        </div>
        <RecommendWidget userEmail={email} authToken={token} isTeacher={view === "teacher"} />
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
        {/* Header — sticky */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20,
          position: "sticky", top: 0, zIndex: 10,
          background: "#fff", paddingTop: 16, paddingBottom: 12,
          borderBottom: "1px solid #f1f5f9",
        }}>
          <div>
            {teacherToken && (
              <button
                onClick={async () => {
                  // Restore teacher token and go back to class overview
                  localStorage.setItem(TOKEN_KEY, teacherToken);
                  localStorage.removeItem(TEACHER_TOKEN_KEY);
                  setToken(teacherToken);
                  setTeacherToken(null);
                  setStudent(null);
                  setResults([]);
                  setOverallAvg(null);
                  setReassigningCode(null);
                  setView("teacher");
                  // Refresh teacher student list (picks up reassignments, new grades, etc.)
                  try {
                    const r2 = await fetch(`${API}/student-progress/teacher/students`, {
                      headers: { Authorization: `Bearer ${teacherToken}` },
                    });
                    const d2 = await r2.json();
                    if (d2.students) setTeacherStudents(d2.students);
                    if (d2.rosterStudents) setRosterStudents(d2.rosterStudents);
                    if (d2.classNames) setTeacherClassNames(d2.classNames);
                  } catch {}
                }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#2563eb", fontSize: 13, fontWeight: 600,
                  padding: "0 0 8px", display: "flex", alignItems: "center", gap: 4,
                }}
              >
                ← Back to Class
              </button>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/images/pulse/pulse-icon.png" alt="Pulse" style={{ height: 28, width: "auto" }} />
              <h1 style={{ ...s.h1, textAlign: "left", fontSize: 24, margin: 0 }}>
                {student ? `${student.firstName} ${student.lastName}` : "My Progress"}
              </h1>
            </div>
            {student?.className && (
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {student.className}
                {student.emailCount > 1 && (
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {student.emailCount} people notified
                  </span>
                )}
                {recommendCount > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: "#d97706",
                    background: "#fef3c7", border: "1px solid #fde68a",
                    padding: "1px 8px", borderRadius: 10,
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                  title={`You've recommended Curriculate to ${recommendCount} teacher${recommendCount !== 1 ? "s" : ""}!`}
                  >
                    {recommendCount === 1 ? "1 referral" : `${recommendCount} referrals`}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
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
            {/* Prev / Next student navigation (teacher view only) */}
            {teacherToken && teacherStudents.length > 1 && student && (() => {
              const classmates = teacherStudents
                .filter((ts) => (ts.className || "General") === (student.className || "General"))
                .sort((a, b) => {
                  const nameA = (a.lastName || a.firstName || "").trim();
                  const nameB = (b.lastName || b.firstName || "").trim();
                  return nameA.localeCompare(nameB) || (a.firstName || "").localeCompare(b.firstName || "");
                });
              const idx = classmates.findIndex((ts) => ts.studentId === studentId);
              if (classmates.length <= 1) return null;
              const prev = idx > 0 ? classmates[idx - 1] : null;
              const next = idx < classmates.length - 1 ? classmates[idx + 1] : null;
              const navigate = async (ts) => {
                // teacherToken holds the original teacher JWT — use it to get the email
                const tToken = teacherToken || localStorage.getItem(TEACHER_TOKEN_KEY);
                if (!tToken) return;
                setStudentId(ts.studentId);
                setStudent(null);
                setResults([]);
                setOverallAvg(null);
                setExpandedResult(null);
                setReassigningCode(null);
                setInfo("");
                setError("");
                setLoading(true);
                try {
                  // Decode teacher email from the teacher token
                  let teacherEmail = "";
                  try {
                    const payload = JSON.parse(atob(tToken.split(".")[1]));
                    teacherEmail = payload.teacherEmail || payload.email || "";
                  } catch {}
                  if (!teacherEmail || !teacherEmail.includes("@")) {
                    // Fallback: try email state
                    teacherEmail = email;
                  }
                  const r2 = await fetch(`${API}/student-progress/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ studentId: ts.studentId, email: teacherEmail }),
                  });
                  const d2 = await r2.json();
                  if (d2.ok && !d2.needsCode && !d2.isTeacherOverview) {
                    localStorage.setItem(TOKEN_KEY, d2.token);
                    setToken(d2.token);
                    setStudent(d2.student || { firstName: ts.firstName, lastName: ts.lastName, className: ts.className });
                  } else {
                    setError(d2.error || "Failed to load student");
                  }
                } catch (err) {
                  setError("Failed to load student");
                } finally {
                  setLoading(false);
                }
              };
              return (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => prev && navigate(prev)}
                    disabled={!prev}
                    title={prev ? `${prev.firstName} ${prev.lastName}` : ""}
                    style={{
                      background: "none", border: "1px solid #e2e8f0", borderRadius: 6,
                      padding: "3px 10px", cursor: prev ? "pointer" : "default",
                      opacity: prev ? 1 : 0.3, fontSize: 14, color: "#2563eb",
                    }}
                    type="button"
                  >
                    ◀
                  </button>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {idx + 1} / {classmates.length}
                  </span>
                  <button
                    onClick={() => next && navigate(next)}
                    disabled={!next}
                    title={next ? `${next.firstName} ${next.lastName}` : ""}
                    style={{
                      background: "none", border: "1px solid #e2e8f0", borderRadius: 6,
                      padding: "3px 10px", cursor: next ? "pointer" : "default",
                      opacity: next ? 1 : 0.3, fontSize: 14, color: "#2563eb",
                    }}
                    type="button"
                  >
                    ▶
                  </button>
                </div>
              );
            })()}
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
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              Choose how each email gets notified about new grades.
            </div>
            {emailPrefs.map((ep) => (
              <div key={ep.address} style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>{ep.address}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[
                    { value: "on-new", label: "On new" },
                    { value: "weekly", label: "Weekly" },
                    { value: "never", label: "Never" },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      disabled={updatingPref === ep.address}
                      onClick={() => updateEmailPref(ep.address, value)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        fontWeight: ep.notify === value ? 700 : 400,
                        borderRadius: 6,
                        border: ep.notify === value ? "1.5px solid #2563eb" : "1px solid #e2e8f0",
                        background: ep.notify === value ? "#eff6ff" : "#fff",
                        color: ep.notify === value ? "#2563eb" : "#64748b",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
              <strong>On new</strong> — notified immediately when a grade is posted.{" "}
              <strong>Weekly</strong> — summary email every Saturday.{" "}
              <strong>Never</strong> — no email notifications.
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
              To add someone, they log in at curriculate.net/progress with the student ID and their email.
              To remove someone, ask your teacher.
            </div>
          </div>
        )}

        {loading && <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading...</div>}

        {!loading && (
          <>
            {/* Overall average with progress bar */}
            {overallAvg != null && (
              <div style={s.avgCard}>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Overall Average</div>
                <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1 }}>{overallAvg}%</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{letterGrade(overallAvg)}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                  {results.length} assignment{results.length !== 1 ? "s" : ""} graded
                </div>
                {/* Progress bar */}
                <div style={{ marginTop: 14, position: "relative", height: 14, borderRadius: 7, overflow: "visible", background: "rgba(255,255,255,0.15)" }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, bottom: 0, width: "100%", borderRadius: 7,
                    background: "linear-gradient(90deg, #fecaca 0%, #fde68a 30%, #d9f99d 55%, #bbf7d0 75%, #6ee7b7 100%)",
                    opacity: 0.85,
                  }} />
                  <div style={{
                    position: "absolute", top: -4, bottom: -4,
                    left: `${Math.min(100, Math.max(0, overallAvg))}%`, transform: "translateX(-50%)",
                    width: 4, borderRadius: 2, zIndex: 3,
                    background: "#fff",
                    boxShadow: "0 0 8px rgba(255,255,255,0.8)",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, fontWeight: 600, opacity: 0.6 }}>
                  <span>F</span>
                  <span>D</span>
                  <span>C</span>
                  <span>B</span>
                  <span>A</span>
                </div>
              </div>
            )}

            {/* Overall KITA / category summary */}
            {(() => {
              // Aggregate category scores across all results
              const catTotals = {}; // { name: { short, totalScore, totalOutOf, count } }
              let anyKita = false;
              for (const r of results) {
                if (!r.categories?.categories?.length) continue;
                anyKita = true;
                for (const cat of r.categories.categories) {
                  if (typeof cat.score !== "number" || typeof cat.outOf !== "number" || cat.outOf <= 0) continue;
                  const key = cat.short || cat.name;
                  if (!catTotals[key]) catTotals[key] = { short: cat.short, name: cat.name, totalScore: 0, totalOutOf: 0, count: 0 };
                  catTotals[key].totalScore += cat.score;
                  catTotals[key].totalOutOf += cat.outOf;
                  catTotals[key].count += 1;
                }
              }
              const catKeys = Object.keys(catTotals);
              if (!anyKita || catKeys.length === 0) return null;

              const pctColor = (pct) =>
                pct >= 80 ? "#059669" : pct >= 70 ? "#22c55e" : pct >= 60 ? "#eab308" : pct >= 50 ? "#f59e0b" : "#ef4444";

              return (
                <div style={{
                  background: "#f8fafc", borderRadius: 12, padding: "14px 16px",
                  marginBottom: 16, border: "1px solid #e2e8f0",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
                    Overall Category Averages
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {catKeys.map((key) => {
                      const c = catTotals[key];
                      const avgScore = c.totalScore / c.count;
                      const avgOutOf = c.totalOutOf / c.count;
                      const pct = Math.round((avgScore / avgOutOf) * 100);
                      const barColor = pctColor(pct);
                      return (
                        <div key={key}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 22, height: 22, borderRadius: 6,
                                background: "rgba(37,99,235,0.1)", fontSize: 11, fontWeight: 900, color: "#2563eb",
                              }}>{c.short}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{c.name}</span>
                              <span style={{ fontSize: 10, color: "#94a3b8" }}>({c.count} asst{c.count !== 1 ? "s" : ""})</span>
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: barColor }}>{pct}%</span>
                          </div>
                          <div style={{ height: 7, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 4, width: `${pct}%`,
                              background: barColor, transition: "width 0.3s ease",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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

            {/* Results grouped by year → subject */}
            <div style={{ fontSize: 16, fontWeight: 700, color: "#334155", marginBottom: 8, marginTop: 20 }}>Results</div>
            {results.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 }}>
                No grading results yet. Results will appear here after your teacher grades your work.
              </div>
            )}
            {(() => {
              // Helper: render a single result row
              const deleteResult = async (code) => {
                if (!teacherToken || !confirm("Delete this assignment result? This cannot be undone.")) return;
                try {
                  const res = await fetch(`${API}/student-progress/teacher/result/${code}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${teacherToken}` },
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setResults((prev) => prev.filter((r) => r.code !== code));
                  } else {
                    setError(data.error || "Failed to delete.");
                  }
                } catch {
                  setError("Failed to delete result.");
                }
              };

              const updateResult = async (code, updates) => {
                if (!teacherToken) { console.warn("[updateResult] No teacherToken"); return; }
                try {
                  const url = `${API}/student-progress/teacher/result/${code}`;
                  console.log("[updateResult]", url, updates);
                  const res = await fetch(url, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` },
                    body: JSON.stringify(updates),
                  });
                  const data = await res.json();
                  console.log("[updateResult] response:", data);
                  if (data.ok) {
                    if (updates.studentId) {
                      // Reassigned to different student — remove from current view
                      setResults((prev) => prev.filter((r) => r.code !== code));
                      setReassigningCode(null);
                    } else {
                      setResults((prev) => prev.map((r) => {
                        if (r.code !== code) return r;
                        const updated = { ...r };
                        if (updates.title) updated.title = updates.title;
                        if (updates.className != null) updated.className = updates.className;
                        return updated;
                      }));
                    }
                  } else {
                    setError(data.error || "Failed to update.");
                  }
                } catch (err) {
                  console.error("[updateResult] error:", err);
                  setError("Failed to update result.");
                }
                setEditingTitleCode(null);
              };

              // Color helpers matching results page
              const pctColor = (pct) =>
                pct >= 80 ? "#059669" : pct >= 70 ? "#22c55e" : pct >= 60 ? "#eab308" : pct >= 50 ? "#f59e0b" : "#ef4444";
              const pctLabel = (pct) =>
                pct >= 90 ? "Exceptional" : pct >= 80 ? "Excellent" : pct >= 70 ? "Proficient"
                : pct >= 60 ? "Developing" : pct >= 50 ? "Approaching" : "Needs Support";
              const levelColors = {
                strong: { bg: "rgba(5,150,105,0.1)", border: "rgba(5,150,105,0.3)", text: "#059669" },
                adequate: { bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.25)", text: "#2563eb" },
                developing: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "#d97706" },
                limited: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)", text: "#dc2626" },
              };

              const ResultRow = ({ r, flat }) => {
                const isNew = r.viewCount === 0;
                const isUnviewed = r.viewCount != null && r.viewCount <= 1;
                const isExpanded = expandedResult === r.code;
                const hasCats = r.categories && r.categories.categories && r.categories.categories.length > 0;
                const hasImages = r.images && r.images.length > 0;
                const canExpand = hasCats || hasImages;
                return (
                <div key={r.code}>
                <div
                  style={{
                    ...s.resultRow,
                    ...(flat ? {} : { borderRadius: 0, margin: 0, borderBottom: "1px solid #f1f5f9" }),
                    ...(isNew ? { background: "#eff6ff", borderLeft: "3px solid #2563eb", paddingLeft: 10 }
                      : isUnviewed ? { background: "#fafbff", borderLeft: "3px solid #c7d2fe", paddingLeft: 10 }
                      : {}),
                    cursor: canExpand ? "pointer" : "default",
                  }}
                  onClick={() => { if (canExpand) setExpandedResult(isExpanded ? null : r.code); }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingTitleCode === r.code ? (
                      <input
                        autoFocus
                        defaultValue={r.title || "Assignment"}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          if (e.target.dataset.saved) return;
                          e.target.dataset.saved = "1";
                          updateResult(r.code, { title: e.target.value.trim() || r.title });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.target.dataset.saved = "1";
                            updateResult(r.code, { title: e.target.value.trim() || r.title });
                          }
                          if (e.key === "Escape") {
                            e.target.dataset.saved = "1";
                            setEditingTitleCode(null);
                          }
                        }}
                        style={{
                          fontWeight: 700, fontSize: 14, color: "#1e293b", width: "100%",
                          border: "1px solid #2563eb", borderRadius: 4, padding: "2px 6px",
                          outline: "none", background: "#eff6ff",
                        }}
                      />
                    ) : (
                      <div
                        style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", cursor: teacherToken ? "text" : canExpand ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6 }}
                        onClick={(e) => { if (teacherToken) { e.stopPropagation(); setEditingTitleCode(r.code); } }}
                        title={teacherToken ? "Click to rename" : canExpand ? "Click to see breakdown" : undefined}
                      >
                        {r.title || "Assignment"}
                        {canExpand && (
                          <span style={{ fontSize: 10, color: "#94a3b8", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>&#9654;</span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {new Date(r.createdAt).toLocaleDateString()}
                      {isNew && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#2563eb", background: "#dbeafe", padding: "1px 5px", borderRadius: 4 }}>NEW</span>
                      )}
                      {r.viewCount > 0 && (() => {
                        const vs = r.viewSources || {};
                        const parts = [];
                        if (vs.progress) parts.push(`${vs.progress} portal`);
                        if (vs.qr) parts.push(`${vs.qr} CurricQR`);
                        if (vs.email) parts.push(`${vs.email} email`);
                        if (vs.direct) parts.push(`${vs.direct} direct`);
                        const tooltip = parts.length
                          ? parts.join(", ") + (r.lastViewedAt ? ` · Last: ${new Date(r.lastViewedAt).toLocaleDateString()}` : "")
                          : r.lastViewedAt ? `Last viewed ${new Date(r.lastViewedAt).toLocaleDateString()}` : "";
                        return (
                          <span style={{ fontSize: 10, color: "#94a3b8" }} title={tooltip}>
                            {r.viewCount} view{r.viewCount !== 1 ? "s" : ""}
                            {parts.length > 0 && (
                              <span style={{ color: "#c7d2fe", marginLeft: 3 }}>
                                ({parts.join(", ")})
                              </span>
                            )}
                          </span>
                        );
                      })()}
                      {teacherToken && teacherClassNames.length > 1 && (
                        <select
                          value={r.className || ""}
                          onChange={(e) => updateResult(r.code, { className: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 11, color: r.className ? "#2563eb" : "#94a3b8",
                            border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 4px",
                            background: "#fff", cursor: "pointer", outline: "none",
                          }}
                          title="Assign to a class"
                        >
                          <option value="">Auto</option>
                          {teacherClassNames.map((cn) => (
                            <option key={cn} value={cn}>{cn}</option>
                          ))}
                        </select>
                      )}
                      {teacherToken && rosterStudents.length > 0 && (
                        <span style={{ position: "relative", display: "inline-block" }}>
                          <span
                            onClick={(e) => { e.stopPropagation(); setReassigningCode(reassigningCode === r.code ? null : r.code); }}
                            style={{
                              fontSize: 10, color: "#d97706", cursor: "pointer",
                              borderBottom: "1px dashed #d97706", fontWeight: 600,
                            }}
                            title="Reassign this result to a different student"
                          >
                            reassign
                          </span>
                          {reassigningCode === r.code && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: "absolute", top: "100%", left: 0, zIndex: 50,
                                background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                                boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 200, maxHeight: 260,
                                overflowY: "auto",
                              }}
                            >
                              <div style={{ padding: "6px 10px", fontSize: 10, color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, position: "sticky", top: 0, background: "#fff" }}>
                                Move to student{r.className ? ` in ${r.className}` : ""}
                              </div>
                              {[...rosterStudents]
                                .filter((ts) => ts.studentId !== (student?.studentId) && (!r.className || ts.className === r.className))
                                .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
                                .map((ts) => (
                                <div
                                  key={ts.studentId}
                                  onClick={() => {
                                    updateResult(r.code, {
                                      studentId: ts.studentId,
                                      studentName: `${ts.firstName} ${ts.lastName}`.trim(),
                                      className: ts.className || r.className || "",
                                    });
                                  }}
                                  style={{
                                    padding: "7px 10px", cursor: "pointer", fontSize: 12,
                                    borderBottom: "1px solid #f1f5f9",
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f1f5f9"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                                >
                                  <span style={{ fontWeight: 600 }}>{ts.firstName} {ts.lastName}</span>
                                  {ts.className && <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 6 }}>{ts.className}</span>}
                                </div>
                              ))}
                              <div
                                onClick={() => setReassigningCode(null)}
                                style={{ padding: "6px 10px", fontSize: 11, color: "#64748b", cursor: "pointer", textAlign: "center", borderTop: "1px solid #e2e8f0" }}
                              >
                                Cancel
                              </div>
                            </div>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginRight: 12 }}>
                    {r.pct != null ? (
                      <>
                        <div style={{ fontWeight: 800, fontSize: 16, color: gradeColor(letterGrade(r.pct)) }}>
                          {letterGrade(r.pct)}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {r.score}/
                          {teacherToken && editingDenomCode === r.code ? (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const newDenom = Math.round(Number(denomInput));
                                if (Number.isFinite(newDenom) && newDenom > 0 && newDenom !== r.outOf) {
                                  if (r.sessionId) {
                                    // Batch update: rescale all results in this batch session
                                    try {
                                      const batchRes = await fetch(`${API}/results/batch-update-denom`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ sessionId: r.sessionId, newDenom }),
                                      });
                                      const batchData = await batchRes.json();
                                      if (batchData.ok && Array.isArray(batchData.results)) {
                                        // Update any local results that were in this batch
                                        const updatedMap = {};
                                        batchData.results.forEach((u) => { updatedMap[u.code] = u; });
                                        setResults((prev) => {
                                          const updated = prev.map((x) => {
                                            const u = updatedMap[x.code];
                                            return u ? { ...x, score: u.score, outOf: u.outOf, pct: u.pct } : x;
                                          });
                                          const pcts = updated.filter((x) => x.pct != null).map((x) => x.pct);
                                          if (pcts.length > 0) {
                                            setOverallAvg(Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length));
                                          }
                                          return updated;
                                        });
                                      }
                                    } catch (err) {
                                      console.warn("[progress] batch denom update failed:", err);
                                    }
                                  } else {
                                    // Single result update (no batch session)
                                    const pct = r.outOf > 0 ? (r.score / r.outOf) * 100 : 0;
                                    const newScore = Math.round((pct / 100) * newDenom * 10) / 10;
                                    const newPct = newDenom > 0 ? Math.round((newScore / newDenom) * 100) : null;
                                    setResults((prev) => {
                                      const updated = prev.map((x) =>
                                        x.code === r.code ? { ...x, score: newScore, outOf: newDenom, pct: newPct } : x
                                      );
                                      const pcts = updated.filter((x) => x.pct != null).map((x) => x.pct);
                                      if (pcts.length > 0) {
                                        setOverallAvg(Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length));
                                      }
                                      return updated;
                                    });
                                    try {
                                      const getRes = await fetch(`${API}/results/${r.code}`);
                                      const getData = await getRes.json();
                                      if (getData.payload) {
                                        const updatedPayload = getData.payload.replace(
                                          /Grade:\s*(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/,
                                          `Grade: ${newScore} / ${newDenom}`
                                        );
                                        await fetch(`${API}/results/${r.code}`, {
                                          method: "PUT",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ payload: updatedPayload }),
                                        });
                                      }
                                    } catch (err) {
                                      console.warn("[progress] denom update failed:", err);
                                    }
                                  }
                                }
                                setEditingDenomCode(null);
                                setDenomInput("");
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{ display: "inline" }}
                            >
                              <input
                                autoFocus
                                type="number"
                                min="1"
                                value={denomInput}
                                onChange={(e) => setDenomInput(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => { setEditingDenomCode(null); setDenomInput(""); }}
                                onKeyDown={(e) => { if (e.key === "Escape") { setEditingDenomCode(null); setDenomInput(""); } }}
                                style={{
                                  width: 40, fontSize: 12, fontWeight: 700,
                                  border: "1px solid #2563eb", borderRadius: 4,
                                  padding: "1px 3px", textAlign: "center", outline: "none",
                                }}
                              />
                            </form>
                          ) : (
                            <span
                              onClick={(e) => {
                                if (!teacherToken) return;
                                e.stopPropagation();
                                setDenomInput(String(r.outOf));
                                setEditingDenomCode(r.code);
                              }}
                              title={teacherToken ? "Click to change denominator" : ""}
                              style={teacherToken ? { cursor: "pointer", borderBottom: "1px dashed #94a3b8" } : {}}
                            >{r.outOf}</span>
                          )}
                          {" "}({r.pct}%)
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: pctColor(r.pct) }}>
                          {pctLabel(r.pct)}
                        </div>
                        {r.classAvg != null && r.classSize > 1 && (
                          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}
                            title={`Class average: ${r.classAvg}% across ${r.classSize} students`}
                          >
                            Class avg: {r.classAvg}%
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 14, color: "#94a3b8" }}>--</div>
                    )}
                  </div>
                  <a href={`/results/${r.code}?src=progress`} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textDecoration: "none", background: "#eff6ff", padding: "6px 10px", borderRadius: 8 }}>
                    {r.code}
                  </a>
                  {teacherToken && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteResult(r.code); }}
                      title="Delete this result"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#cbd5e1", fontSize: 16, fontWeight: 700, lineHeight: 1,
                        padding: "4px 6px", marginLeft: 6, borderRadius: 4,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "#cbd5e1"; }}
                    >
                      &times;
                    </button>
                  )}
                </div>
                {/* Expanded KITA / category breakdown + source images */}
                {isExpanded && (() => {
                  const hasImages = r.images && r.images.length > 0;
                  if (!hasCats && !hasImages) return null;
                  const categories = hasCats ? r.categories.categories : [];
                  const weightedTotal = hasCats ? r.categories.weightedTotal : null;
                  const isKita = hasCats ? r.categories.isKita : false;
                  const scored = categories.filter((c) => typeof c.score === "number" && typeof c.outOf === "number" && c.outOf > 0);
                  return (
                    <div style={{
                      padding: "10px 14px 14px",
                      background: "rgba(37,99,235,0.02)",
                      borderBottom: "1px solid #e2e8f0",
                    }}>
                      {/* Source images */}
                      {hasImages && (
                        <div style={{ marginBottom: hasCats ? 12 : 0 }}>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: r.images.length === 1 ? "1fr" : "repeat(auto-fill, minmax(140px, 1fr))",
                            gap: 8,
                          }}>
                            {r.images.map((url, ii) => (
                              <a key={ii} href={url} target="_blank" rel="noreferrer">
                                <img
                                  src={url}
                                  alt={`Page ${ii + 1}`}
                                  style={{
                                    width: "100%", maxHeight: 200, objectFit: "contain",
                                    borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc",
                                    cursor: "zoom-in",
                                  }}
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {!hasCats ? null : (<>
                    {/* Category bars (existing) */}
                      {/* Category bars */}
                      <div style={{ display: "grid", gap: 8 }}>
                        {categories.map((cat, ci) => {
                          const hasSc = typeof cat.score === "number" && typeof cat.outOf === "number" && cat.outOf > 0;
                          const catPct = hasSc ? Math.round((cat.score / cat.outOf) * 100) : null;
                          const lc = cat.level ? (levelColors[cat.level] || levelColors.adequate) : null;
                          const barColor = catPct != null ? pctColor(catPct) : (lc ? lc.text : "#94a3b8");

                          return (
                            <div key={ci}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{
                                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                                    width: 20, height: 20, borderRadius: 5,
                                    background: isKita ? "rgba(37,99,235,0.12)" : (lc ? lc.bg : "rgba(37,99,235,0.08)"),
                                    fontSize: 10, fontWeight: 900,
                                    color: isKita ? "#2563eb" : (lc ? lc.text : "#2563eb"),
                                  }}>{cat.short}</span>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>{cat.name}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  {cat.weight && <span style={{ fontSize: 10, color: "#94a3b8" }}>{cat.weight}%</span>}
                                  {hasSc && <span style={{ fontSize: 12, fontWeight: 800, color: barColor }}>{cat.score}/{cat.outOf}</span>}
                                  {cat.level && !hasSc && (
                                    <span style={{ fontSize: 11, fontWeight: 700, color: lc ? lc.text : "#64748b", textTransform: "capitalize" }}>{cat.level}</span>
                                  )}
                                </div>
                              </div>
                              {catPct != null && (
                                <div style={{ height: 6, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
                                  <div style={{
                                    height: "100%", borderRadius: 3, width: `${catPct}%`,
                                    background: barColor,
                                    transition: "width 0.3s ease",
                                  }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Overall progress bar — same gradient as results page */}
                      {scored.length > 0 && (() => {
                        const totalScore = scored.reduce((s, c) => s + c.score, 0);
                        const totalOutOf = scored.reduce((s, c) => s + c.outOf, 0);
                        const pct = totalOutOf > 0 ? Math.min(100, Math.max(0, (totalScore / totalOutOf) * 100)) : 0;
                        const displayPct = weightedTotal != null ? weightedTotal : Math.round(pct);

                        return (
                          <div style={{ marginTop: 10, padding: "8px 0 0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: pctColor(displayPct) }}>{pctLabel(displayPct)}</span>
                              <span style={{ fontSize: 12, fontWeight: 900, color: "#1e293b" }}>
                                {weightedTotal != null ? `${weightedTotal}%` : `${totalScore.toFixed(1)}/${totalOutOf.toFixed(1)}`}
                              </span>
                            </div>
                            <div style={{ position: "relative", height: 14, borderRadius: 7, overflow: "visible", background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
                              <div style={{
                                position: "absolute", top: 0, left: 0, bottom: 0, width: "100%", borderRadius: 7,
                                background: "linear-gradient(90deg, #fecaca 0%, #fde68a 30%, #d9f99d 55%, #bbf7d0 75%, #6ee7b7 100%)",
                              }} />
                              <div style={{
                                position: "absolute", top: -4, bottom: -4,
                                left: `${displayPct}%`, transform: "translateX(-50%)",
                                width: 4, borderRadius: 2, zIndex: 3,
                                background: "#dc2626",
                                boxShadow: "0 0 6px rgba(220,38,38,0.5)",
                              }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, fontWeight: 600, color: "#94a3b8" }}>
                              <span>Needs Support</span>
                              <span>Developing</span>
                              <span>Proficient</span>
                              <span>Excellent</span>
                            </div>
                          </div>
                        );
                      })()}
                    </>)}
                    </div>
                  );
                })()}
                </div>
                );
              };

              // Helper: compute average from result items
              const calcAvg = (items) => {
                const pcts = items.filter((r) => r.pct != null).map((r) => r.pct);
                return pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
              };

              // Build className lookup: if a result has className "MATH7B" and
              // another has subject "Math" but no className, merge into "MATH7B"
              const knownClasses = [...new Set(results.map((r) => r.className).filter(Boolean))];
              const resolveGroup = (r) => {
                if (r.className) return r.className;
                // Try to match subject to a known className (e.g. "Math" → "MATH7B")
                const subj = (r.subject || "").toLowerCase();
                if (subj) {
                  const match = knownClasses.find((cn) => cn.toLowerCase().includes(subj));
                  if (match) return match;
                }
                return r.subject || "General";
              };

              // Group by academic year (Sep–Aug) then subject/class
              const byYear = {};
              results.forEach((r) => {
                const d = new Date(r.createdAt);
                const m = d.getMonth(); // 0-based
                const y = d.getFullYear();
                // Academic year: Sep 2025 – Aug 2026 = "2025–2026"
                const startYear = m >= 8 ? y : y - 1; // Aug (7) and earlier → previous academic year
                const yearLabel = `${startYear}\u2013${startYear + 1}`;
                const subj = resolveGroup(r);
                if (!byYear[yearLabel]) byYear[yearLabel] = {};
                if (!byYear[yearLabel][subj]) byYear[yearLabel][subj] = [];
                byYear[yearLabel][subj].push(r);
              });
              const years = Object.keys(byYear).sort().reverse(); // newest first

              // Stable sorted list of all subjects for consistent color assignment
              const allSubjects = [...new Set(results.map((r) => resolveGroup(r)))].sort();
              const subjColorMap = buildSubjectColorMap(allSubjects);

              // Only one year and one subject — flat list, no bars
              const totalSubjects = allSubjects.length;
              if (years.length <= 1 && totalSubjects <= 1) {
                return results.map((r) => <ResultRow key={r.code} r={r} flat />);
              }

              // Render year → subject hierarchy
              return years.map((year) => {
                const yearSubjects = byYear[year];
                const subjKeys = Object.keys(yearSubjects).sort();
                const allYearItems = subjKeys.flatMap((s) => yearSubjects[s]);
                const yearAvg = calcAvg(allYearItems);
                const yearOpen = expandedYears[year] !== false; // default open for current year
                const isCurrentYear = year === years[0]; // most recent

                return (
                  <div key={year} style={{ marginBottom: 12 }}>
                    {/* Year bar — only show if multiple years */}
                    {years.length > 1 && (
                      <button
                        onClick={() => setExpandedYears((prev) => ({ ...prev, [year]: !yearOpen }))}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "12px 16px", background: "linear-gradient(135deg, #1e293b, #334155)",
                          border: "none", borderRadius: yearOpen ? "12px 12px 0 0" : 12,
                          cursor: "pointer", color: "#fff",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, transition: "transform 0.15s", transform: yearOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>&#9654;</span>
                          <span style={{ fontWeight: 800, fontSize: 15 }}>{year}</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>{allYearItems.length} assignment{allYearItems.length !== 1 ? "s" : ""}</span>
                        </div>
                        {yearAvg != null && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 800, fontSize: 15 }}>{yearAvg}%</span>
                            <span style={{ fontWeight: 700, fontSize: 13, opacity: 0.85 }}>{letterGrade(yearAvg)}</span>
                          </div>
                        )}
                      </button>
                    )}

                    {/* Year content */}
                    {(yearOpen || years.length <= 1) && (
                      <div style={years.length > 1 ? { border: "1px solid #e2e8f0", borderTop: "none", borderRadius: "0 0 12px 12px", padding: "8px 0", overflow: "hidden" } : {}}>
                        {subjKeys.length <= 1 ? (
                          // Single subject in this year — no subject bar
                          allYearItems.map((r) => <ResultRow key={r.code} r={r} flat />)
                        ) : (
                          // Multiple subjects — expandable bars
                          subjKeys.map((subj) => {
                            const items = yearSubjects[subj];
                            const subjAvg = calcAvg(items);
                            const subjKey = `${year}|${subj}`;
                            const isOpen = expandedSubjects[subjKey] !== false; // default open
                            const sc = subjectColor(subj, subjColorMap);

                            return (
                              <div key={subjKey} style={{ margin: years.length > 1 ? "4px 8px" : "0 0 6px" }}>
                                <button
                                  onClick={() => setExpandedSubjects((prev) => isOpen ? { ...prev, [subjKey]: false } : { [subjKey]: true })}
                                  style={{
                                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                                    padding: "10px 14px", background: sc.bg,
                                    border: `1px solid ${sc.border}`, borderRadius: isOpen ? "10px 10px 0 0" : 10,
                                    cursor: "pointer",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 12, color: sc.text, opacity: 0.6, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>&#9654;</span>
                                    <span style={{ fontWeight: 700, fontSize: 14, color: sc.text }}>{subj}</span>
                                    <span style={{ fontSize: 12, color: sc.text, opacity: 0.6 }}>{items.length} assignment{items.length !== 1 ? "s" : ""}</span>
                                  </div>
                                  {subjAvg != null && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontWeight: 800, fontSize: 14, color: gradeColor(letterGrade(subjAvg)) }}>{subjAvg}%</span>
                                      <span style={{ fontWeight: 700, fontSize: 12, color: gradeColor(letterGrade(subjAvg)) }}>{letterGrade(subjAvg)}</span>
                                    </div>
                                  )}
                                </button>
                                {isOpen && (
                                  <div style={{ border: "1px solid #e2e8f0", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                                    {items.map((r) => <ResultRow key={r.code} r={r} />)}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </>
        )}
      </div>
      <RecommendWidget userEmail={email} authToken={token} isTeacher={false} />
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#94a3b8" }}>
        curriculate.net/progress
      </div>
    </div>
  );
}
