// student-app/src/pages/DemoPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRunner from "../components/tasks/TaskRunner.jsx";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.curriculate.net";

// Demo pacing
const DEFAULT_REVIEW_SECONDS = 15;
const BOT_THINK_MIN_MS = 900;
const BOT_THINK_MAX_MS = 2200;

// Physical tasks: no review lock + no AI scoring (mirrors StudentApp intention)
const PHYSICAL_TYPES = new Set(
  [
    TASK_TYPES.BODY_BREAK,
    TASK_TYPES.MAD_DASH,
    TASK_TYPES.MAD_DASH_SEQUENCE,
    TASK_TYPES.MOTION_MISSION,
    // add more “movement/physical” types here if needed
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
);

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function isPhysicalTask(task) {
  const t = String(task?.taskType || task?.type || "").toLowerCase();
  return (
    !!(
      task?.isPhysical ||
      task?.config?.isPhysical ||
      task?.movement ||
      task?.config?.movement
    ) || PHYSICAL_TYPES.has(t)
  );
}

function isObjectiveTask(task) {
  const type = task?.taskType || task?.type;
  const meta = TASK_TYPE_META?.[type] || {};
  return meta.objectiveScoring === true;
}

/**
 * Local deterministic scoring for objective tasks (fast, demo-safe).
 * Returns { scoreDelta, maxPoints, correct, details }
 */
function scoreObjectiveLocally(task, submission) {
  const type = task?.taskType || task?.type;
  const points = typeof task?.points === "number" ? task.points : 10;

  // Multi-part payloads sometimes wrap primitives. We accept:
  // - submission.answer (primitive or object)
  // - submission.answers (array)
  const normPrimitive = (raw) => {
    if (raw == null) return null;
    if (typeof raw !== "object") return raw;
    if (typeof raw.baseIndex === "number") return raw.baseIndex;
    if (raw.value != null) return raw.value;
    if (raw.answer != null) return raw.answer;
    return raw;
  };

  // TRUE/FALSE / MULTIPLE CHOICE / SHORT ANSWER (objective variants)
  if (
    [TASK_TYPES.TRUE_FALSE, TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.SHORT_ANSWER].includes(
      type
    )
  ) {
    const items = Array.isArray(task.items) ? task.items : null;

    // Multi-question
    if (items && items.length) {
      const per = points; // your system often treats "points" as per-item; keep as-is for demo
      let correctCount = 0;
      const studentAnswers = Array.isArray(submission?.answers) ? submission.answers : [];

      items.forEach((it, idx) => {
        const s = normPrimitive(studentAnswers[idx]);
        const c = it?.correctAnswer;
        if (c == null || s == null) return;

        // Index or text matching when options exist
        const opts = Array.isArray(it?.options)
          ? it.options
          : Array.isArray(task.options)
          ? task.options
          : [];

        let ok = false;
        if (typeof c === "number" && opts[c] != null) {
          const correctText = String(opts[c]).trim().toLowerCase();
          if (typeof s === "number") ok = s === c;
          else ok = String(s).trim().toLowerCase() === correctText;
        } else if (Array.isArray(c)) {
          const ns = String(s).trim().toLowerCase();
          ok = c.some((x) => String(x).trim().toLowerCase() === ns);
        } else {
          ok = String(s).trim().toLowerCase() === String(c).trim().toLowerCase();
        }

        if (ok) correctCount += 1;
      });

      const scoreDelta = correctCount * per;
      return {
        scoreDelta,
        maxPoints: items.length * per,
        correct: correctCount === items.length,
        details: { correctCount, total: items.length },
      };
    }

    // Single question
    const s = normPrimitive(submission?.answer ?? submission?.text ?? null);
    const c = task?.correctAnswer;

    if (s == null || c == null) {
      return { scoreDelta: 0, maxPoints: points, correct: false, details: { reason: "missing" } };
    }

    const opts = Array.isArray(task?.options) ? task.options : [];
    let ok = false;

    if (typeof c === "number" && opts[c] != null) {
      const correctText = String(opts[c]).trim().toLowerCase();
      if (typeof s === "number") ok = s === c;
      else ok = String(s).trim().toLowerCase() === correctText;
    } else if (Array.isArray(c)) {
      const ns = String(s).trim().toLowerCase();
      ok = c.some((x) => String(x).trim().toLowerCase() === ns);
    } else {
      ok = String(s).trim().toLowerCase() === String(c).trim().toLowerCase();
    }

    return {
      scoreDelta: ok ? points : 0,
      maxPoints: points,
      correct: ok,
      details: {},
    };
  }

  // SORT (bucketIndex mapping expected)
  if (type === TASK_TYPES.SORT) {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const correctItems = Array.isArray(cfg.items) ? cfg.items : [];
    const mapping = submission?.mapping || submission?.answer?.mapping || {};
    const total = correctItems.length || 1;
    const per = points / total;

    let correctCount = 0;
    correctItems.forEach((it) => {
      if (!it) return;
      const expected = it.bucketIndex;
      const key = it.id ?? it.text;
      const got = mapping?.[key];
      if (typeof expected === "number" && got != null && Number(got) === Number(expected)) {
        correctCount += 1;
      }
    });

    return {
      scoreDelta: Math.round(correctCount * per),
      maxPoints: points,
      correct: correctCount === total,
      details: { correctCount, total },
    };
  }

  // SEQUENCE / TIMELINE (order array of ids or indices)
  if (type === TASK_TYPES.SEQUENCE || type === TASK_TYPES.TIMELINE) {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const total = items.length || 1;
    const per = points / total;

    const order = submission?.order || submission?.answer?.order || [];
    if (!Array.isArray(order) || order.length === 0) {
      return { scoreDelta: 0, maxPoints: points, correct: false, details: { reason: "no order" } };
    }

    // Correct ids derived from config order
    const correctIds = items.map((it, idx) => it?.id ?? `item-${idx}`);

    // If numeric array, treat as index-per-position
    const allNumeric = order.length === total && order.every((v) => Number.isInteger(v));
    let correctCount = 0;

    if (allNumeric) {
      for (let i = 0; i < total; i++) {
        if (order[i] === i) correctCount += 1;
      }
    } else {
      correctIds.forEach((id, idx) => {
        if (order[idx] === id) correctCount += 1;
      });
    }

    return {
      scoreDelta: Math.round(correctCount * per),
      maxPoints: points,
      correct: correctCount === total,
      details: { correctCount, total },
    };
  }

  // Default: unknown objective type → give 0, don’t crash
  return { scoreDelta: 0, maxPoints: points, correct: false, details: { reason: "unsupported objective" } };
}

/**
 * Very lightweight bot answer generator (good enough for demo/testing).
 * It tries to create plausible shapes that tasks accept.
 */
function makeBotSubmission(task) {
  const type = task?.taskType || task?.type;

  // Multi-part MC/TF/ShortAnswer
  if ([TASK_TYPES.TRUE_FALSE, TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.SHORT_ANSWER].includes(type)) {
    const items = Array.isArray(task.items) ? task.items : null;

    if (items && items.length) {
      const answers = items.map((it) => {
        // choose random option index if options exist, else random boolean/text
        const opts = Array.isArray(it?.options)
          ? it.options
          : Array.isArray(task?.options)
          ? task.options
          : null;

        if (opts && opts.length) return randInt(0, opts.length - 1);
        if (type === TASK_TYPES.TRUE_FALSE) return Math.random() < 0.5 ? "True" : "False";
        return "We think it's because it matches the prompt.";
      });

      return { answers };
    }

    // single question
    if (type === TASK_TYPES.TRUE_FALSE) return { answer: Math.random() < 0.5 ? "True" : "False" };
    if (type === TASK_TYPES.MULTIPLE_CHOICE) {
      const opts = Array.isArray(task?.options) ? task.options : [];
      return { answer: opts.length ? randInt(0, opts.length - 1) : 0 };
    }
    if (type === TASK_TYPES.SHORT_ANSWER) return { answer: "Our best guess." };
  }

  // OPEN_TEXT
  if (type === TASK_TYPES.OPEN_TEXT) {
    return { answer: { text: "We discussed it and wrote a clear explanation with an example." } };
  }

  // PHOTO / PHOTO_JOURNAL / MAKE_AND_SNAP
  if (
    type === TASK_TYPES.PHOTO ||
    type === TASK_TYPES.PHOTO_JOURNAL ||
    type === TASK_TYPES.MAKE_AND_SNAP
  ) {
    return {
      answer: {
        text: "We took a photo that matches the prompt and explained why it fits.",
        // demo: no raw blobs
        hasPhoto: true,
      },
    };
  }

  // SORT: random mapping
  if (type === TASK_TYPES.SORT) {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const buckets = Array.isArray(cfg.buckets) ? cfg.buckets : [];
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const mapping = {};
    items.forEach((it) => {
      const key = it?.id ?? it?.text;
      if (!key) return;
      mapping[key] = buckets.length ? randInt(0, buckets.length - 1) : 0;
    });
    return { mapping };
  }

  // SEQUENCE/TIMELINE: random order by ids
  if (type === TASK_TYPES.SEQUENCE || type === TASK_TYPES.TIMELINE) {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const ids = items.map((it, idx) => it?.id ?? `item-${idx}`);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return { order: ids };
  }

  // default generic
  return { answer: "Submitted." };
}

export default function DemoPage() {
  // -------------------------
  // Demo session state
  // -------------------------
  const [phase, setPhase] = useState("mood"); // mood | runner | task
  const [demoTaskset, setDemoTaskset] = useState(null);

  const [adminKey, setAdminKey] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [currentTask, setCurrentTask] = useState(null);

  // Review lock (non-physical only)
  const [taskLocked, setTaskLocked] = useState(false);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const postSubmitTimerRef = useRef(null);

  // Scoring UI
  const [toast, setToast] = useState(null);

  // -------------------------
  // Team simulator
  // -------------------------
  const [botCount, setBotCount] = useState(3); // you + 3 bots = 4 teams
  const [teams, setTeams] = useState(() => {
    const base = [{ id: "team-you", teamName: "Your Team", isYou: true, score: 0 }];
    for (let i = 1; i <= 3; i++) {
      base.push({ id: `team-bot-${i}`, teamName: `Bot Team ${i}`, isYou: false, score: 0 });
    }
    return base;
  });

  // Update teams when botCount changes (keep scores where possible)
  useEffect(() => {
    setTeams((prev) => {
      const you = prev.find((t) => t.id === "team-you") || {
        id: "team-you",
        teamName: "Your Team",
        isYou: true,
        score: 0,
      };
      const next = [you];

      for (let i = 1; i <= botCount; i++) {
        const id = `team-bot-${i}`;
        const existing = prev.find((t) => t.id === id);
        next.push(
          existing || { id, teamName: `Bot Team ${i}`, isYou: false, score: 0 }
        );
      }
      return next;
    });
  }, [botCount]);

  const leaderboard = useMemo(() => {
    return [...teams].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [teams]);

  // -------------------------
  // Socket stub (TaskRunner-safe)
  // -------------------------
  const demoSocket = useMemo(
    () => ({
      on: () => {},
      off: () => {},
      emit: (_event, _payload, ack) => {
        // Some tasks emit with ACK callbacks; don’t let them hang.
        if (typeof ack === "function") ack({ ok: true, demo: true });
      },
    }),
    []
  );

  // -------------------------
  // Demo pool IO
  // -------------------------
  async function loadDemoTaskset() {
    const res = await fetch(`${API_BASE}/api/demo/taskset`);
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "Failed to load demo taskset");
    setDemoTaskset(json.taskset);
  }

  async function regenerateDemoTaskset(key) {
    const res = await fetch(`${API_BASE}/api/demo/taskset/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "x-demo-admin-key": key } : {}),
      },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "Failed to regenerate demo taskset");
    setDemoTaskset(json.taskset);
  }

  // Load once
  useEffect(() => {
    loadDemoTaskset().catch((e) => console.warn("[DemoPage] load demo pool failed:", e));
    return () => {
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
        postSubmitTimerRef.current = null;
      }
    };
  }, []);

  // -------------------------
  // Phase tasks
  // -------------------------
  const moodTask = useMemo(
    () => ({
      taskType: TASK_TYPES.MOOD_CHECKIN,
      title: "Mood Check-in",
      prompt: "How are you doing today?",
      timeLimitSeconds: 45,
      points: 0,
    }),
    []
  );

  const runnerTask = useMemo(
    () => ({
      taskType: TASK_TYPES.TREASURE_RUNNER,
      title: "Treasure Runner",
      prompt: "Warm-up while waiting…",
      timeLimitSeconds: 0,
      points: 0,
    }),
    []
  );

  const allTaskTypes = useMemo(() => {
    // Prefer meta keys (future proof). Fall back to TASK_TYPES values.
    const fromMeta = TASK_TYPE_META ? Object.keys(TASK_TYPE_META) : [];
    const fromConst = Object.values(TASK_TYPES).filter((v) => typeof v === "string");
    const set = new Set([...fromMeta, ...fromConst].filter(Boolean));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, []);

  function pickDemoTask(type) {
    const tasks = demoTaskset?.tasks || demoTaskset?.items || [];
    const match = tasks.find((t) => (t.taskType || t.type) === type);
    if (match) return match;

    // Minimal placeholder if demo pool doesn’t include that type yet
    return {
      taskType: type,
      title: `Demo: ${type}`,
      prompt: "Demo task (pool does not include a pre-generated instance for this type yet).",
      timeLimitSeconds: 60,
      points: 10,
    };
  }

  // -------------------------
  // UI helpers
  // -------------------------
  function showToast(message, positive = true) {
    setToast({ message, positive });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2200);
  }

  function clearReviewLock() {
    if (postSubmitTimerRef.current) {
      clearInterval(postSubmitTimerRef.current);
      postSubmitTimerRef.current = null;
    }
    setTaskLocked(false);
    setPostSubmitSecondsLeft(null);
  }

  function goBackToRunner() {
    clearReviewLock();
    setPhase("runner");
    setCurrentTask(null);
    // keep selectedType so “Try again” works
  }

  // -------------------------
  // Bot simulation per task
  // -------------------------
  const botTimersRef = useRef([]);

  function clearBotTimers() {
    botTimersRef.current.forEach((t) => clearTimeout(t));
    botTimersRef.current = [];
  }

  function simulateBotsForTask(task) {
    clearBotTimers();

    const bots = teams.filter((t) => !t.isYou);
    if (!bots.length) return;

    bots.forEach((bot) => {
      const delay = randInt(BOT_THINK_MIN_MS, BOT_THINK_MAX_MS);
      const t = setTimeout(() => {
        // Physical tasks: bots “complete” instantly with tiny random points
        if (isPhysicalTask(task)) {
          const delta = randInt(0, 2);
          setTeams((prev) =>
            prev.map((x) => (x.id === bot.id ? { ...x, score: (x.score || 0) + delta } : x))
          );
          return;
        }

        // Objective: deterministic local scoring
        if (isObjectiveTask(task)) {
          const sub = makeBotSubmission(task);
          const scored = scoreObjectiveLocally(task, sub);
          setTeams((prev) =>
            prev.map((x) =>
              x.id === bot.id
                ? { ...x, score: (x.score || 0) + (scored.scoreDelta || 0) }
                : x
            )
          );
          return;
        }

        // AI-scored: simulate (avoid spamming OpenAI calls)
        const max = typeof task?.points === "number" ? task.points : 10;
        const delta = randInt(Math.floor(max * 0.3), Math.floor(max * 0.9));
        setTeams((prev) =>
          prev.map((x) => (x.id === bot.id ? { ...x, score: (x.score || 0) + delta } : x))
        );
      }, delay);

      botTimersRef.current.push(t);
    });
  }

  // When entering task phase, trigger bot simulation
  useEffect(() => {
    if (phase === "task" && currentTask) simulateBotsForTask(currentTask);
    return () => clearBotTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentTask]);

  // -------------------------
  // Player scoring (objective local; AI via backend)
  // -------------------------
  async function scoreWithBackendAI(task, submission) {
    // You can change this endpoint to your real scoring route if different.
    // This is intentionally simple: backend decides rubric/scoring based on type.
    const res = await fetch(`${API_BASE}/api/ai/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "demo",
        task,
        submission,
      }),
    });
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "AI scoring failed");

    // Normalize a few possible shapes
    const scoreDelta =
      typeof json.scoreDelta === "number"
        ? json.scoreDelta
        : typeof json.score === "number"
        ? json.score
        : typeof json.points === "number"
        ? json.points
        : 0;

    const maxPoints =
      typeof json.maxPoints === "number"
        ? json.maxPoints
        : typeof task?.points === "number"
        ? task.points
        : null;

    return { scoreDelta, maxPoints, aiFeedback: json.aiFeedback || json.reason || null };
  }

  async function handleSubmit(submissionPayload) {
    const task = currentTask;
    if (!task) return;

    // Physical: no lock, bounce back immediately
    if (isPhysicalTask(task)) {
      showToast("Completed (physical task)", true);
      goBackToRunner();
      return;
    }

    // Score player
    let scoreDelta = 0;
    let maxPoints = typeof task?.points === "number" ? task.points : null;

    try {
      if (isObjectiveTask(task)) {
        const result = scoreObjectiveLocally(task, submissionPayload);
        scoreDelta = result.scoreDelta || 0;
        maxPoints = result.maxPoints ?? maxPoints;
      } else {
        // AI scoring (server-side)
        const ai = await scoreWithBackendAI(task, submissionPayload);
        scoreDelta = ai.scoreDelta || 0;
        maxPoints = ai.maxPoints ?? maxPoints;
      }
    } catch (e) {
      console.warn("[DemoPage] scoring error:", e);
      showToast(e?.message || "Scoring error", false);
      // still apply review lock so flow feels consistent
    }

    // Apply score to "your team"
    setTeams((prev) =>
      prev.map((t) =>
        t.isYou ? { ...t, score: (t.score || 0) + scoreDelta } : t
      )
    );

    // Review lock (non-physical)
    const lockSeconds = DEFAULT_REVIEW_SECONDS;
    setTaskLocked(true);
    setPostSubmitSecondsLeft(lockSeconds);

    if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);
    let t = lockSeconds;
    postSubmitTimerRef.current = setInterval(() => {
      t -= 1;
      setPostSubmitSecondsLeft(t);
      if (t <= 0) {
        clearReviewLock();
        goBackToRunner();
      }
    }, 1000);

    if (scoreDelta > 0) showToast(`+${scoreDelta}${maxPoints ? ` / ${maxPoints}` : ""}`, true);
    else showToast("Submitted", true);
  }

  // -------------------------
  // Admin actions
  // -------------------------
  async function onRegeneratePool() {
    const key = adminKey.trim();
    if (!key) return showToast("Enter admin key first", false);
    try {
      await regenerateDemoTaskset(key);
      showToast("Demo pool regenerated", true);
    } catch (e) {
      showToast(e?.message || "Regenerate failed", false);
    }
  }

  function startSelectedTask() {
    if (!selectedType) return;
    const next = pickDemoTask(selectedType);
    setCurrentTask(next);
    setPhase("task");
  }

  // -------------------------
  // Render
  // -------------------------
  return (
    <div style={{ minHeight: "100vh", padding: 18, background: "#0b1220", color: "#fff" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Curriculate Demo</div>
          <div style={{ opacity: 0.8, marginTop: 4, fontSize: 13 }}>
            Mood → Treasure Runner → Pick a task (TaskRunner renders everything)
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ opacity: 0.85, fontSize: 13 }}>Bot teams:</div>
            <input
              type="number"
              min={0}
              max={7}
              value={botCount}
              onChange={(e) => setBotCount(clamp(Number(e.target.value || 0), 0, 7))}
              style={{
                width: 70,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                fontWeight: 800,
              }}
            />
          </div>

          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin key"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              width: 150,
            }}
          />
          <button
            onClick={onRegeneratePool}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.10)",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Regenerate Pool
          </button>

          <button
            onClick={() => loadDemoTaskset().then(() => showToast("Pool refreshed", true)).catch(() => showToast("Refresh failed", false))}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Refresh Pool
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: toast.positive ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
            fontWeight: 900,
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Leaderboard */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>Leaderboard</div>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Phase: <span style={{ fontWeight: 900 }}>{phase}</span>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {leaderboard.map((t, i) => (
            <div
              key={t.id}
              style={{
                padding: "8px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: t.isYou ? "rgba(59,130,246,0.18)" : "rgba(0,0,0,0.18)",
                fontWeight: 900,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i + 1}. {t.teamName}: {t.score || 0}
            </div>
          ))}
        </div>
      </div>

      {/* Phase: Mood */}
      {phase === "mood" && (
        <div style={{ marginTop: 16 }}>
          <TaskRunner
            task={moodTask}
            onSubmit={() => setPhase("runner")}
            disabled={false}
            mode="play"
            roomCode={"DEMO"}
            playerTeam={{ id: "team-you", teamName: "Your Team" }}
            memberNames={["Demo"]}
            socket={demoSocket}
          />
        </div>
      )}

      {/* Phase: Runner + Picker */}
      {phase === "runner" && (
        <div style={{ marginTop: 16 }}>
          <TaskRunner
            task={runnerTask}
            onSubmit={() => {}}
            disabled={false}
            mode="play"
            roomCode={"DEMO"}
            playerTeam={{ id: "team-you", teamName: "Your Team" }}
            memberNames={["Demo"]}
            socket={demoSocket}
          />

          <div
            style={{
              marginTop: 16,
              borderRadius: 16,
              padding: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Choose a task to demo</div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                style={{
                  flex: "1 1 320px",
                  minWidth: 320,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(0,0,0,0.18)",
                  color: "#fff",
                  fontWeight: 800,
                }}
              >
                <option value="">— Select a task type —</option>
                {allTaskTypes.map((t) => (
                  <option key={t} value={t} style={{ color: "#000" }}>
                    {t}
                  </option>
                ))}
              </select>

              <button
                onClick={startSelectedTask}
                disabled={!selectedType}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: !selectedType ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: !selectedType ? "not-allowed" : "pointer",
                }}
              >
                Start Task
              </button>
            </div>

            <div style={{ marginTop: 10, opacity: 0.78, fontSize: 13 }}>
              Objective tasks score locally. AI-scored tasks call the backend scoring route for <strong>your team</strong>. Bots simulate AI scores.
            </div>
          </div>
        </div>
      )}

      {/* Phase: Task */}
      {phase === "task" && currentTask && (
        <div style={{ marginTop: 16, position: "relative" }}>
          {/* Review overlay (non-physical only) */}
          {taskLocked && !isPhysicalTask(currentTask) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              {postSubmitSecondsLeft != null && (() => {
                const lockTotal = DEFAULT_REVIEW_SECONDS;
                const percent =
                  lockTotal > 0 ? Math.round((postSubmitSecondsLeft / lockTotal) * 100) : 0;

                return (
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 420,
                      borderRadius: 14,
                      background: "#0b1220",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.15)",
                      padding: 14,
                      position: "relative",
                      boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
                    }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.18)" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${percent}%`,
                            background: "rgba(255,255,255,0.9)",
                            transition: "width 200ms linear",
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ paddingTop: 10 }}>
                      <div style={{ fontWeight: 900, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                        Review your answer…
                      </div>
                      <div
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          fontSize: "1.1rem",
                          marginTop: 4,
                          fontWeight: 900,
                        }}
                      >
                        {postSubmitSecondsLeft}s
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ opacity: taskLocked ? 0.6 : 1 }}>
            <TaskRunner
              task={currentTask}
              onSubmit={handleSubmit}
              disabled={taskLocked}
              submitting={false}
              mode="play"
              roomCode={"DEMO"}
              playerTeam={{ id: "team-you", teamName: "Your Team" }}
              memberNames={["Demo"]}
              socket={demoSocket}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={goBackToRunner}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              ← Back to Treasure Runner
            </button>

            <button
              onClick={() => {
                const next = pickDemoTask(selectedType || (currentTask?.taskType || currentTask?.type));
                setCurrentTask({ ...next });
                setPhase("task");
              }}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.10)",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Try again (same type)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
