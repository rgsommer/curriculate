// student-app/src/DemoMode.jsx
//
// Conference Demo Mode — standalone task showcase.
// Visitors scan one CurricQR at the booth, enter name + email,
// then auto-rotate through sample tasks. Results are captured
// per-user and emailed as a report with a free signup credit.

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import DEMO_TASKS from "./demoTasks.js";
import { API_BASE_URL } from "./config.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const AUTO_ADVANCE_MS = 90_000; // 90 seconds per task

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
}

// Simple email validation
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ----------------------------------------------------------------
// Phase: Email Capture
// ----------------------------------------------------------------

function EmailCapture({ onStart }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email.");
    setError("");
    setSubmitting(true);

    // Register with backend (fire-and-forget if it fails — demo still works)
    try {
      await fetch(`${API_BASE_URL}/api/conference/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: role.trim() || undefined,
          registeredAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.warn("[demo] registration fetch failed:", err);
    }

    setSubmitting(false);
    onStart({ name: name.trim(), email: email.trim().toLowerCase(), role: role.trim() });
  };

  return (
    <div style={styles.captureOuter}>
      <div style={styles.captureCard}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🎯</div>
        <h1 style={styles.captureTitle}>Try Curriculate</h1>
        <p style={styles.captureSubtitle}>
          Experience 25+ interactive task types used in classrooms worldwide.
          Takes about 5 minutes — or skip around!
        </p>

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <label style={styles.label}>Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sarah"
            style={styles.input}
            autoFocus
          />

          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            style={styles.input}
          />

          <label style={styles.label}>Role (optional)</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Grade 5 Teacher, VP, IT Lead"
            style={styles.input}
          />

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={submitting} style={styles.startBtn}>
            {submitting ? "Loading…" : "Start Demo →"}
          </button>
        </form>

        <p style={{ fontSize: 11, opacity: 0.5, marginTop: 16, textAlign: "center" }}>
          We'll email you a report of your results + a free 1-month credit.
        </p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Playing Tasks
// ----------------------------------------------------------------

function DemoPlayer({ user, onFinish }) {
  const [taskIdx, setTaskIdx] = useState(0);
  const [results, setResults] = useState([]); // { taskType, title, answer, score, completedAt }
  const [remainingMs, setRemainingMs] = useState(AUTO_ADVANCE_MS);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);
  const startedRef = useRef(Date.now());

  // Stub socket so TaskRunner's socket.emit/on/off calls don't crash
  const demoSocket = useMemo(
    () => ({
      on: () => {},
      off: () => {},
      emit: (_event, _payload, ack) => {
        if (typeof ack === "function") ack({ ok: true, demo: true });
      },
    }),
    []
  );

  const task = DEMO_TASKS[taskIdx] || null;
  const total = DEMO_TASKS.length;

  // Auto-advance timer
  useEffect(() => {
    startedRef.current = Date.now();
    setRemainingMs(AUTO_ADVANCE_MS);

    if (paused) return;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedRef.current;
      const rem = AUTO_ADVANCE_MS - elapsed;
      if (rem <= 0) {
        clearInterval(timerRef.current);
        // Auto-advance (record as skipped)
        setResults((prev) => [
          ...prev,
          {
            taskType: task?.taskType,
            title: task?.title,
            answer: null,
            skipped: true,
            completedAt: new Date().toISOString(),
          },
        ]);
        if (taskIdx < total - 1) {
          setTaskIdx((i) => i + 1);
        } else {
          onFinish(results);
        }
      } else {
        setRemainingMs(rem);
      }
    }, 250);

    return () => clearInterval(timerRef.current);
  }, [taskIdx, paused]);

  // Submit handler — captures the visitor's answer
  const handleSubmit = useCallback(
    (answer) => {
      const entry = {
        taskType: task?.taskType,
        title: task?.title,
        answer: typeof answer === "object" ? JSON.stringify(answer) : String(answer ?? ""),
        skipped: false,
        completedAt: new Date().toISOString(),
      };
      setResults((prev) => [...prev, entry]);

      // Brief pause to show feedback, then advance
      setTimeout(() => {
        if (taskIdx < total - 1) {
          setTaskIdx((i) => i + 1);
        } else {
          onFinish([...results, entry]);
        }
      }, 1200);
    },
    [task, taskIdx, total, results, onFinish]
  );

  const goNext = useCallback(() => {
    // Record as skipped
    setResults((prev) => [
      ...prev,
      {
        taskType: task?.taskType,
        title: task?.title,
        answer: null,
        skipped: true,
        completedAt: new Date().toISOString(),
      },
    ]);
    if (taskIdx < total - 1) {
      setTaskIdx((i) => i + 1);
    } else {
      onFinish(results);
    }
  }, [task, taskIdx, total, results, onFinish]);

  const goPrev = useCallback(() => {
    if (taskIdx > 0) setTaskIdx((i) => i - 1);
  }, [taskIdx]);

  const handleDone = useCallback(() => {
    onFinish(results);
  }, [results, onFinish]);

  const progressPct = ((taskIdx + 1) / total) * 100;
  const timerPct = (remainingMs / AUTO_ADVANCE_MS) * 100;

  return (
    <div style={styles.playerOuter}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={{ fontWeight: 900, fontSize: 15 }}>Curriculate Demo</span>
          <span style={styles.badge}>
            {taskIdx + 1} / {total}
          </span>
        </div>
        <div style={styles.topBarRight}>
          <span style={{ fontSize: 13, fontWeight: 600, color: remainingMs < 10000 ? "#ef4444" : "#64748b" }}>
            {formatTime(remainingMs)}
          </span>
          <button onClick={handleDone} style={styles.doneBtn}>
            I'm done
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={styles.progressOuter}>
        <div style={{ ...styles.progressInner, width: `${progressPct}%` }} />
      </div>

      {/* Timer bar */}
      <div style={styles.timerOuter}>
        <div
          style={{
            height: "100%",
            width: `${timerPct}%`,
            background: remainingMs < 15000
              ? "linear-gradient(90deg, #ef4444, #f97316)"
              : "linear-gradient(90deg, #3b82f6, #8b5cf6)",
            borderRadius: 2,
            transition: "width 0.25s linear",
          }}
        />
      </div>

      {/* Task type label */}
      <div style={styles.taskTypeLabel}>
        <span style={styles.taskTypeBadge}>{task?.taskType?.replace(/-/g, " ")}</span>
        <span style={{ fontWeight: 800, fontSize: 16 }}>{task?.title}</span>
      </div>

      {/* Task Runner */}
      <div style={styles.taskArea}>
        <TaskRunner
          key={`demo-${taskIdx}`}
          task={task}
          taskIndex={taskIdx}
          taskTypes={DEMO_TASKS.map((t) => t.taskType)}
          onSubmit={handleSubmit}
          submitting={false}
          disabled={false}
          socket={demoSocket}
          mode="play"
          memberNames={[user.name]}
          roomCode="DEMO"
          playerTeam={user.name}
        />
      </div>

      {/* Nav buttons */}
      <div style={styles.navBar}>
        <button onClick={goPrev} disabled={taskIdx === 0} style={{ ...styles.navBtn, opacity: taskIdx === 0 ? 0.3 : 1 }}>
          ← Previous
        </button>
        <button onClick={goNext} style={styles.navBtn}>
          {taskIdx < total - 1 ? "Skip →" : "Finish →"}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Results & Signup CTA
// ----------------------------------------------------------------

function DemoResults({ user, results }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const completed = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  // Send results to backend for email
  useEffect(() => {
    if (sent || sending) return;
    setSending(true);
    fetch(`${API_BASE_URL}/api/conference/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        role: user.role,
        results,
        completedAt: new Date().toISOString(),
      }),
    })
      .then(() => setSent(true))
      .catch((err) => {
        console.warn("[demo] results submit failed:", err);
        setSent(true); // don't block UI
      })
      .finally(() => setSending(false));
  }, []);

  return (
    <div style={styles.resultsOuter}>
      <div style={styles.resultsCard}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>
          Great job, {user.name}!
        </h1>
        <p style={{ fontSize: 15, color: "#64748b", marginBottom: 20 }}>
          You tried {completed.length} task type{completed.length !== 1 ? "s" : ""} out of {DEMO_TASKS.length}.
        </p>

        {/* Task types tried */}
        <div style={{ width: "100%", marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Tasks you completed:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {completed.map((r, i) => (
              <span
                key={i}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  background: "#dcfce7",
                  color: "#15803d",
                  border: "1px solid #bbf7d0",
                }}
              >
                ✓ {r.title}
              </span>
            ))}
          </div>
        </div>

        {skipped.length > 0 && (
          <div style={{ width: "100%", marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, opacity: 0.6 }}>
              Skipped ({skipped.length}):
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {skipped.map((r, i) => (
                <span
                  key={i}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    background: "#f1f5f9",
                    color: "#94a3b8",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {r.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Free credit CTA */}
        <div
          style={{
            width: "100%",
            padding: 20,
            borderRadius: 16,
            background: "linear-gradient(135deg, #eff6ff, #f0f9ff)",
            border: "2px solid #93c5fd",
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 900, color: "#1e40af", marginBottom: 4 }}>
            🎁 1 Month Free
          </div>
          <div style={{ fontSize: 14, color: "#3b82f6", marginBottom: 12 }}>
            Use code <strong style={{ fontSize: 18, letterSpacing: 2 }}>CONFERENCE2025</strong> when you sign up
          </div>
          <a
            href="https://curriculate.net/pricing"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              padding: "12px 28px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              color: "#fff",
              fontWeight: 900,
              fontSize: 15,
              textDecoration: "none",
              boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
            }}
          >
            Sign Up Free →
          </a>
        </div>

        {/* Email confirmation */}
        <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
          {sent
            ? `✓ A report has been emailed to ${user.email}`
            : sending
            ? "Sending your report…"
            : ""}
        </p>

        {/* Play again */}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 12,
            padding: "10px 24px",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: "#fff",
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
            color: "#475569",
          }}
        >
          Play Again
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Main DemoMode Component
// ----------------------------------------------------------------

export default function DemoMode() {
  const [phase, setPhase] = useState("capture"); // capture | play | results
  const [user, setUser] = useState(null);
  const [results, setResults] = useState([]);

  const handleStart = useCallback((u) => {
    setUser(u);
    setPhase("play");
  }, []);

  const handleFinish = useCallback((r) => {
    setResults(r);
    setPhase("results");
  }, []);

  return (
    <div style={styles.root}>
      {phase === "capture" && <EmailCapture onStart={handleStart} />}
      {phase === "play" && user && <DemoPlayer user={user} onFinish={handleFinish} />}
      {phase === "results" && user && <DemoResults user={user} results={results} />}
    </div>
  );
}

// ----------------------------------------------------------------
// Styles
// ----------------------------------------------------------------

const styles = {
  root: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#f8fafc",
  },

  // Email Capture
  captureOuter: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  captureCard: {
    width: "100%",
    maxWidth: 420,
    padding: 32,
    borderRadius: 24,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(20px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  captureTitle: {
    fontSize: 28,
    fontWeight: 900,
    marginBottom: 8,
    background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  captureSubtitle: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#94a3b8",
    marginBottom: 4,
    marginTop: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.07)",
    color: "#f8fafc",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
  },
  error: {
    marginTop: 8,
    fontSize: 13,
    color: "#f87171",
    fontWeight: 600,
  },
  startBtn: {
    marginTop: 20,
    width: "100%",
    padding: "14px 24px",
    borderRadius: 14,
    border: "none",
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    color: "#fff",
    fontWeight: 900,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(59,130,246,0.3)",
  },

  // Player
  playerOuter: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 16px",
    background: "rgba(0,0,0,0.3)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  topBarRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  badge: {
    padding: "3px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    background: "rgba(59,130,246,0.2)",
    color: "#93c5fd",
    border: "1px solid rgba(59,130,246,0.3)",
  },
  doneBtn: {
    padding: "6px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "#f8fafc",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  progressOuter: {
    height: 4,
    background: "rgba(255,255,255,0.08)",
  },
  progressInner: {
    height: "100%",
    background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  timerOuter: {
    height: 3,
    background: "rgba(255,255,255,0.05)",
  },
  taskTypeLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px",
  },
  taskTypeBadge: {
    padding: "3px 10px",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(139,92,246,0.2)",
    color: "#c4b5fd",
    border: "1px solid rgba(139,92,246,0.3)",
    textTransform: "capitalize",
  },
  taskArea: {
    flex: 1,
    overflow: "auto",
    padding: "0 8px 8px",
  },
  navBar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 16px 20px",
    background: "rgba(0,0,0,0.2)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  navBtn: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#f8fafc",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
    textAlign: "center",
  },

  // Results
  resultsOuter: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  resultsCard: {
    width: "100%",
    maxWidth: 480,
    padding: 32,
    borderRadius: 24,
    background: "#fff",
    color: "#0f172a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
};
