// student-app/src/DemoMode.jsx
//
// Conference Demo / Classroom Practice Mode — standalone task showcase.
// Visitors or students enter name + email, rotate through sample tasks,
// earn points per completed task. Results are captured per-user and
// emailed as a report.
//
// Props (set via route):
//   source="conference" → conference branding + promo code
//   source="classroom"  → classroom branding + leaderboard

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import DEMO_TASKS from "./demoTasks.js";
import { API_BASE_URL } from "./config.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const AUTO_ADVANCE_MS = 90_000; // 90 seconds per task

// Default points per task type (backend is source of truth; these are fallback)
const DEFAULT_TASK_POINTS = {
  "multiple-choice": 10, "true-false": 10, "short-answer": 15,
  sort: 15, sequence: 15, matching: 15, flashcards: 10,
  "flashcards-race": 20, timeline: 15, vennsort: 20,
  "brain-blitz": 25, "open-text": 15, "hangman-duel": 20,
  "speed-draw": 25, "pet-feeding": 15, spinner: 10,
  trivia: 15, riddle: 20, "tower-builder": 20, "reading-comp": 20,
  "diff-detective": 20, "echo-chain": 15, "word-weaver-duel": 20,
  "body-break": 10, "mind-mapper": 20,
};
const DEFAULT_PTS = 10;

function getTaskPts(taskType, pointsMap) {
  return (pointsMap || DEFAULT_TASK_POINTS)[taskType] || DEFAULT_PTS;
}

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ----------------------------------------------------------------
// Phase: Email Capture
// ----------------------------------------------------------------

function EmailCapture({ onStart, source, classroom, promoCode }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isClassroom = source === "classroom";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email.");
    setError("");
    setSubmitting(true);

    let taskPoints = null;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/conference/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: role.trim() || undefined,
          source,
          classroom: classroom || "",
          promoCode: promoCode || "CONFERENCE2025",
        }),
      });
      const data = await resp.json();
      if (data.taskPoints) taskPoints = data.taskPoints;
    } catch (err) {
      console.warn("[demo] registration fetch failed:", err);
    }

    setSubmitting(false);
    onStart({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: role.trim(),
      taskPoints: taskPoints || DEFAULT_TASK_POINTS,
    });
  };

  return (
    <div style={styles.captureOuter}>
      <div style={styles.captureCard}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>{isClassroom ? "🎓" : "🎯"}</div>
        <h1 style={styles.captureTitle}>
          {isClassroom ? "Practice Mode" : "Try Curriculate"}
        </h1>
        <p style={styles.captureSubtitle}>
          {isClassroom
            ? "Try 25+ interactive task types and earn points! Your teacher can see your progress."
            : "Experience 25+ interactive task types used in classrooms worldwide. Takes about 5 minutes — or skip around!"}
        </p>

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <label style={styles.label}>Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isClassroom ? "e.g. Sarah J." : "e.g. Sarah"}
            style={styles.input}
            autoFocus
          />

          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isClassroom ? "your school email" : "you@school.edu"}
            style={styles.input}
          />

          {!isClassroom && (
            <>
              <label style={styles.label}>Role (optional)</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Grade 5 Teacher, VP, IT Lead"
                style={styles.input}
              />
            </>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={submitting} style={styles.startBtn}>
            {submitting ? "Loading…" : isClassroom ? "Start Practicing →" : "Start Demo →"}
          </button>
        </form>

        <p style={{ fontSize: 11, opacity: 0.5, marginTop: 16, textAlign: "center" }}>
          {isClassroom
            ? "We'll email you a report of your results and points earned."
            : "We'll email you a report of your results + a free 1-month credit."}
        </p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Task Feedback Popup (shown after each completed task)
// ----------------------------------------------------------------

function TaskFeedback({ taskType, taskTitle, onSubmit, onSkip }) {
  const [fun, setFun] = useState(0); // 1-5 stars
  const [clarity, setClarity] = useState(0); // 1-5 stars
  const [confusing, setConfusing] = useState("");
  const [suggestion, setSuggestion] = useState("");

  const handleSubmit = () => {
    onSubmit({ fun, clarity, confusing: confusing.trim(), suggestion: suggestion.trim() });
  };

  const Star = ({ filled, onClick }) => (
    <span
      onClick={onClick}
      style={{
        fontSize: 24,
        cursor: "pointer",
        color: filled ? "#f59e0b" : "#334155",
        transition: "transform 0.15s",
        display: "inline-block",
      }}
    >
      {filled ? "★" : "☆"}
    </span>
  );

  return (
    <div style={feedbackStyles.overlay}>
      <div style={feedbackStyles.card}>
        <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>
          Quick feedback on:
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", marginBottom: 16 }}>
          {taskTitle || taskType}
        </div>

        {/* Fun rating */}
        <div style={feedbackStyles.row}>
          <span style={feedbackStyles.label}>Was it fun?</span>
          <div style={feedbackStyles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} filled={n <= fun} onClick={() => setFun(n)} />
            ))}
          </div>
        </div>

        {/* Clarity rating */}
        <div style={feedbackStyles.row}>
          <span style={feedbackStyles.label}>Was it clear?</span>
          <div style={feedbackStyles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} filled={n <= clarity} onClick={() => setClarity(n)} />
            ))}
          </div>
        </div>

        {/* Confusing text */}
        <div style={{ marginBottom: 12 }}>
          <label style={feedbackStyles.textLabel}>Anything confusing?</label>
          <input
            type="text"
            value={confusing}
            onChange={(e) => setConfusing(e.target.value)}
            placeholder="e.g. I didn't understand the instructions"
            style={feedbackStyles.textInput}
          />
        </div>

        {/* Suggestion */}
        <div style={{ marginBottom: 16 }}>
          <label style={feedbackStyles.textLabel}>Suggestions?</label>
          <input
            type="text"
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder="e.g. Add a hint button"
            style={feedbackStyles.textInput}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onSkip} style={feedbackStyles.skipBtn}>
            Skip
          </button>
          <button onClick={handleSubmit} style={feedbackStyles.submitBtn}>
            Submit & Continue
          </button>
        </div>
      </div>
    </div>
  );
}

const feedbackStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    padding: 20,
    animation: "feedbackFadeIn 0.2s ease-out",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    padding: 24,
    borderRadius: 20,
    background: "rgba(30,41,59,0.95)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#f8fafc",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: 700,
    color: "#cbd5e1",
  },
  stars: {
    display: "flex",
    gap: 4,
  },
  textLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#94a3b8",
    marginBottom: 4,
  },
  textInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.07)",
    color: "#f8fafc",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  },
  skipBtn: {
    flex: 1,
    padding: "10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "transparent",
    color: "#94a3b8",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  submitBtn: {
    flex: 2,
    padding: "10px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    color: "#fff",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
  },
};

// ----------------------------------------------------------------
// Points Pop Animation
// ----------------------------------------------------------------

function PointsPop({ points }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!visible || !points) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: 48,
        fontWeight: 900,
        color: "#f59e0b",
        textShadow: "0 2px 12px rgba(245,158,11,0.5)",
        animation: "pointsPop 1.2s ease-out forwards",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      +{points}
    </div>
  );
}

// ----------------------------------------------------------------
// Streak Banner
// ----------------------------------------------------------------

function StreakBanner({ streak }) {
  if (streak < 3) return null;
  const labels = { 3: "🔥 3-streak!", 5: "🔥🔥 5-streak!", 10: "🔥🔥🔥 ON FIRE!" };
  const label = labels[streak] || (streak >= 10 ? labels[10] : `🔥 ${streak}-streak!`);

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "6px 18px",
        borderRadius: 20,
        background: "linear-gradient(135deg, #f59e0b, #ef4444)",
        color: "#fff",
        fontWeight: 900,
        fontSize: 14,
        zIndex: 9999,
        boxShadow: "0 4px 16px rgba(245,158,11,0.4)",
        animation: "streakSlide 0.4s ease-out",
      }}
    >
      {label}
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Playing Tasks
// ----------------------------------------------------------------

function DemoPlayer({ user, onFinish, source }) {
  const [taskIdx, setTaskIdx] = useState(0);
  const [results, setResults] = useState([]);
  const [remainingMs, setRemainingMs] = useState(AUTO_ADVANCE_MS);
  const [paused, setPaused] = useState(false);
  const [totalPoints, setTotalPoints] = useState(0);
  const [lastEarned, setLastEarned] = useState(null); // for pop animation
  const [streak, setStreak] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false); // feedback popup
  const [pendingEntry, setPendingEntry] = useState(null); // entry awaiting feedback
  const timerRef = useRef(null);
  const startedRef = useRef(Date.now());
  const popKeyRef = useRef(0);
  const isClassroom = source === "classroom";

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
  const nextTaskPts = task ? getTaskPts(task.taskType, user.taskPoints) : 0;

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
        setResults((prev) => [
          ...prev,
          {
            taskType: task?.taskType,
            title: task?.title,
            answer: null,
            skipped: true,
            points: 0,
            completedAt: new Date().toISOString(),
          },
        ]);
        setStreak(0);
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

  // Submit handler — earns points, then shows feedback popup
  const handleSubmit = useCallback(
    (answer) => {
      const pts = getTaskPts(task?.taskType, user.taskPoints);
      const entry = {
        taskType: task?.taskType,
        title: task?.title,
        answer: typeof answer === "object" ? JSON.stringify(answer) : String(answer ?? ""),
        skipped: false,
        points: pts,
        completedAt: new Date().toISOString(),
      };
      setTotalPoints((p) => p + pts);
      setStreak((s) => s + 1);

      // Trigger points pop
      popKeyRef.current += 1;
      setLastEarned({ pts, key: popKeyRef.current });

      // Pause timer and show feedback popup
      clearInterval(timerRef.current);
      setPendingEntry(entry);
      setTimeout(() => setShowFeedback(true), 800); // brief delay for points pop
    },
    [task, taskIdx, total, results, onFinish, user.taskPoints]
  );

  // Handle feedback submission or skip
  const handleFeedback = useCallback(
    (feedback) => {
      const entry = { ...pendingEntry, feedback: feedback || null };
      const newResults = [...results, entry];
      setResults(newResults);
      setShowFeedback(false);
      setPendingEntry(null);

      if (taskIdx < total - 1) {
        setTaskIdx((i) => i + 1);
      } else {
        onFinish(newResults);
      }
    },
    [pendingEntry, results, taskIdx, total, onFinish]
  );

  const goNext = useCallback(() => {
    setResults((prev) => [
      ...prev,
      {
        taskType: task?.taskType,
        title: task?.title,
        answer: null,
        skipped: true,
        points: 0,
        completedAt: new Date().toISOString(),
      },
    ]);
    setStreak(0);
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
      {/* Points pop */}
      {lastEarned && <PointsPop key={lastEarned.key} points={lastEarned.pts} />}

      {/* Streak banner */}
      <StreakBanner streak={streak} />

      {/* Task feedback popup */}
      {showFeedback && pendingEntry && (
        <TaskFeedback
          taskType={pendingEntry.taskType}
          taskTitle={pendingEntry.title}
          onSubmit={(fb) => handleFeedback(fb)}
          onSkip={() => handleFeedback(null)}
        />
      )}

      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={{ fontWeight: 900, fontSize: 15 }}>
            {isClassroom ? "Practice Mode" : "Curriculate Demo"}
          </span>
          <span style={styles.badge}>
            {taskIdx + 1} / {total}
          </span>
        </div>
        <div style={styles.topBarRight}>
          {/* Points counter */}
          <div style={styles.pointsCounter}>
            <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>PTS</span>
            <span style={styles.pointsValue}>{totalPoints}</span>
          </div>

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

      {/* Task type label + points preview */}
      <div style={styles.taskTypeLabel}>
        <span style={styles.taskTypeBadge}>{task?.taskType?.replace(/-/g, " ")}</span>
        <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{task?.title}</span>
        <span style={styles.ptsBadge}>+{nextTaskPts} pts</span>
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

      {/* CSS animations */}
      <style>{`
        @keyframes pointsPop {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
          40%  { opacity: 1; transform: translate(-50%, -50%) scale(1.3); }
          100% { opacity: 0; transform: translate(-50%, -120%) scale(1); }
        }
        @keyframes streakSlide {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes feedbackFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ----------------------------------------------------------------
// Phase: Results & Signup CTA
// ----------------------------------------------------------------

function DemoResults({ user, results, source, promoCode = "CONFERENCE2025" }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const isClassroom = source === "classroom";

  const completed = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const totalPoints = results.reduce((s, r) => s + (r.points || 0), 0);

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
        source,
        completedAt: new Date().toISOString(),
      }),
    })
      .then(() => setSent(true))
      .catch((err) => {
        console.warn("[demo] results submit failed:", err);
        setSent(true);
      })
      .finally(() => setSending(false));
  }, []);

  return (
    <div style={styles.resultsOuter}>
      <div style={styles.resultsCard}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>
          {isClassroom ? `Awesome, ${user.name}!` : `Great job, ${user.name}!`}
        </h1>

        {/* Points hero */}
        <div
          style={{
            width: "100%",
            padding: 20,
            borderRadius: 16,
            background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
            border: "2px solid #fde68a",
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 14, color: "#92400e", fontWeight: 700, marginBottom: 4 }}>
            Total Points Earned
          </div>
          <div style={{ fontSize: 48, fontWeight: 900, color: "#f59e0b" }}>{totalPoints}</div>
          <div style={{ fontSize: 13, color: "#a16207" }}>
            {completed.length} task{completed.length !== 1 ? "s" : ""} completed out of {DEMO_TASKS.length}
          </div>
        </div>

        {/* Task badges */}
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
                ✓ {r.title} (+{r.points || 0})
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

        {/* CTA section */}
        {!isClassroom && (
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
              Use code <strong style={{ fontSize: 18, letterSpacing: 2 }}>{promoCode}</strong> when you sign up
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
        )}

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

export default function DemoMode({ source = "conference", classroom = "" }) {
  const [phase, setPhase] = useState("capture"); // capture | play | results
  const [user, setUser] = useState(null);
  const [results, setResults] = useState([]);

  // Allow URL params to override source/classroom
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const effectiveSource = params.get("source") || source;
  const effectiveClassroom = params.get("classroom") || classroom;
  const effectivePromo = params.get("promo") || "CONFERENCE2025";

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
      {phase === "capture" && (
        <EmailCapture
          onStart={handleStart}
          source={effectiveSource}
          classroom={effectiveClassroom}
          promoCode={effectivePromo}
        />
      )}
      {phase === "play" && user && (
        <DemoPlayer user={user} onFinish={handleFinish} source={effectiveSource} />
      )}
      {phase === "results" && user && (
        <DemoResults user={user} results={results} source={effectiveSource} promoCode={effectivePromo} />
      )}
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
  pointsCounter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    borderRadius: 10,
    background: "rgba(245,158,11,0.15)",
    border: "1px solid rgba(245,158,11,0.3)",
  },
  pointsValue: {
    fontSize: 16,
    fontWeight: 900,
    color: "#fbbf24",
  },
  ptsBadge: {
    padding: "3px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    background: "rgba(245,158,11,0.15)",
    color: "#fbbf24",
    border: "1px solid rgba(245,158,11,0.25)",
    whiteSpace: "nowrap",
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
