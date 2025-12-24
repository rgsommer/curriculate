// student-app/src/pages/DemoPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRunner from "../components/tasks/TaskRunner.jsx";
import { TASK_TYPES, TASK_TYPE_META } from "../../../shared/taskTypes.js";
import ProgressFillButton from "../components/ProgressFillButton";

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

  const normPrimitive = (raw) => {
    if (raw == null) return null;
    if (typeof raw !== "object") return raw;
    if (typeof raw.baseIndex === "number") return raw.baseIndex;
    if (raw.value != null) return raw.value;
    if (raw.answer != null) return raw.answer;
    return raw;
  };

  if (
    [TASK_TYPES.TRUE_FALSE, TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.SHORT_ANSWER].includes(
      type
    )
  ) {
    const items = Array.isArray(task.items) ? task.items : null;

    if (items && items.length) {
      const per = points;
      let correctCount = 0;
      const studentAnswers = Array.isArray(submission?.answers) ? submission.answers : [];

      items.forEach((it, idx) => {
        const s = normPrimitive(studentAnswers[idx]);
        const c = it?.correctAnswer;
        if (c == null || s == null) return;

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

  if (type === TASK_TYPES.SEQUENCE || type === TASK_TYPES.TIMELINE) {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const total = items.length || 1;
    const per = points / total;

    const order = submission?.order || submission?.answer?.order || [];
    if (!Array.isArray(order) || order.length === 0) {
      return { scoreDelta: 0, maxPoints: points, correct: false, details: { reason: "no order" } };
    }

    const correctIds = items.map((it, idx) => it?.id ?? `item-${idx}`);
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

  return { scoreDelta: 0, maxPoints: points, correct: false, details: { reason: "unsupported objective" } };
}

/**
 * Lightweight bot answer generator (good enough for demo/testing).
 */
function makeBotSubmission(task) {
  const type = task?.taskType || task?.type;

  if ([TASK_TYPES.TRUE_FALSE, TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.SHORT_ANSWER].includes(type)) {
    const items = Array.isArray(task.items) ? task.items : null;

    if (items && items.length) {
      const answers = items.map((it) => {
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

    if (type === TASK_TYPES.TRUE_FALSE) return { answer: Math.random() < 0.5 ? "True" : "False" };
    if (type === TASK_TYPES.MULTIPLE_CHOICE) {
      const opts = Array.isArray(task?.options) ? task.options : [];
      return { answer: opts.length ? randInt(0, opts.length - 1) : 0 };
    }
    if (type === TASK_TYPES.SHORT_ANSWER) return { answer: "Our best guess." };
  }

  if (type === TASK_TYPES.OPEN_TEXT) {
    return { answer: { text: "We discussed it and wrote a clear explanation with an example." } };
  }

  if (
    type === TASK_TYPES.PHOTO ||
    type === TASK_TYPES.PHOTO_JOURNAL ||
    type === TASK_TYPES.MAKE_AND_SNAP
  ) {
    return {
      answer: {
        text: "We took a photo that matches the prompt and explained why it fits.",
        hasPhoto: true,
      },
    };
  }

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

  return { answer: "Submitted." };
}

// EchoChain (demo-only) SFX
function playEchoChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg");
    a.volume = 0.18;
    a.play();
  } catch {
    // ignore
  }
}

// NarrationSynthesize (demo-only) SFX
function playNarrationChime() {
  try {
    const a = new Audio(
      "https://actions.google.com/sounds/v1/cartoon/concussive_hit_guitar_boing.ogg"
    );
    a.volume = 0.14;
    a.play();
  } catch {
    // ignore
  }
}

// -------------------------
// Safe fetch helper (prevents “Unexpected token '<'”)
// -------------------------
async function fetchJsonSafe(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (likely HTML error page)
    const head = (text || "").slice(0, 200);
    const err = new Error(`Expected JSON but got: ${head}`);
    err.status = res.status;
    err.raw = text;
    throw err;
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

export default function DemoPage() {
  const [phase, setPhase] = useState("mood"); // mood | runner | task
  const [demoTaskset, setDemoTaskset] = useState(null);

  // Admin key is hidden until “Regenerate” is clicked
  const [adminKey, setAdminKey] = useState("");
  const [showAdminKey, setShowAdminKey] = useState(false);

  const [selectedType, setSelectedType] = useState("");
  const [currentTask, setCurrentTask] = useState(null);

  const [taskLocked, setTaskLocked] = useState(false);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const postSubmitTimerRef = useRef(null);

  const [toast, setToast] = useState(null);

  // “Generate all types” streaming UI (ProgressFillButton)
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(1);
  const [status, setStatus] = useState("");
  const esRef = useRef(null);

  const progress = total > 0 ? done / total : 0;

  // Hidden by default (you asked not to show bot count). Keep a sane default.
  const [botCount] = useState(3);

  const [teams, setTeams] = useState(() => {
    const base = [{ id: "team-you", teamName: "Your Team", isYou: true, score: 0 }];
    for (let i = 1; i <= 3; i++) {
      base.push({ id: `team-bot-${i}`, teamName: `Bot Team ${i}`, isYou: false, score: 0 });
    }
    return base;
  });

  // Leaderboard + derived totals
  const leaderboard = useMemo(() => {
    return [...teams].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [teams]);

  const yourScore = useMemo(() => {
    const you = teams.find((t) => t.isYou);
    return you?.score || 0;
  }, [teams]);

  // Socket stub (TaskRunner-safe)
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
  }

  // -------------------------
  // Demo pool IO
  // -------------------------
  async function loadDemoTaskset() {
    const json = await fetchJsonSafe(`${API_BASE}/api/demo/taskset`);
    if (!json?.ok) throw new Error(json?.error || "Failed to load demo taskset");
    setDemoTaskset(json.taskset);
    return json.taskset;
  }

  async function regenerateDemoTaskset(key) {
    const json = await fetchJsonSafe(`${API_BASE}/api/demo/taskset/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-demo-admin-key": key,
      },
      body: JSON.stringify({}),
    });
    if (!json?.ok) throw new Error(json?.error || "Failed to regenerate demo taskset");
    setDemoTaskset(json.taskset);
    return json.taskset;
  }

  // -------------------------
  // Streaming generation (ProgressFillButton)
  // -------------------------
  function cleanupEventSource() {
    try {
      if (esRef.current) esRef.current.close();
    } catch {}
    esRef.current = null;
  }

  const startDemoGeneration = async () => {
    if (generating) return;

    // We require the admin key to generate the full demo pool.
    const key = adminKey.trim();
    if (!showAdminKey) {
      setShowAdminKey(true);
      showToast("Enter admin code to regenerate", false);
      return;
    }
    if (!key) {
      showToast("Admin code required", false);
      return;
    }

    setGenerating(true);
    setDone(0);
    setTotal(1);
    setStatus("Starting…");

    cleanupEventSource();

    const payload = {
      adminKey: key,
      // room for future: { includeNonEligible: false, ... }
    };

    const url = `${API_BASE}/api/demo/taskset/stream?payload=${encodeURIComponent(
      JSON.stringify(payload)
    )}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("start", (e) => {
      try {
        const data = JSON.parse(e.data);
        setTotal(Number(data.total) || 1);
        setDone(Number(data.done) || 0);
        setStatus("Generating…");
      } catch {
        setStatus("Generating…");
      }
    });

    es.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setDone(Number(data.done) || 0);
        setTotal(Number(data.total) || 1);
        if (data.currentType) setStatus(`Generating: ${data.currentType}`);
      } catch {}
    });

    es.addEventListener("done", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.taskset) setDemoTaskset(data.taskset);
      } catch {}
      setStatus("Done");
      setGenerating(false);
      cleanupEventSource();
      showToast("Demo pool regenerated", true);
    });

    es.addEventListener("error", () => {
      // EventSource fires "error" on disconnect too; handle carefully
      setStatus("Error / disconnected");
      setGenerating(false);
      cleanupEventSource();
      showToast("Stream disconnected", false);
    });
  };

  // Load once
  useEffect(() => {
    loadDemoTaskset()
      .then(() => showToast("Demo pool loaded", true))
      .catch((e) => {
        console.warn("[DemoPage] load demo pool failed:", e);
        showToast(e?.message || "Load demo pool failed", false);
      });

    return () => {
      cleanupEventSource();
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
        postSubmitTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const fromMeta = TASK_TYPE_META ? Object.keys(TASK_TYPE_META) : [];
    const fromConst = Object.values(TASK_TYPES).filter((v) => typeof v === "string");
    const set = new Set([...fromMeta, ...fromConst].filter(Boolean));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, []);

  function pickDemoTask(type) {
    const tasks = demoTaskset?.tasks || demoTaskset?.items || [];
    const match = tasks.find((t) => (t.taskType || t.type) === type);
    if (match) return match;

    // EchoChain: provide a rich fallback so the TaskRunner can render it properly in demo mode.
    if (type === TASK_TYPES.ECHO_CHAIN) {
      return {
        taskType: TASK_TYPES.ECHO_CHAIN,
        title: "Echo Chain",
        prompt:
          "Say the chain aloud. Player 1 repeats the starter word and adds one related word. Player 2 repeats the whole chain and adds one. Keep going until someone forgets a word or changes the order.",
        timeLimitSeconds: 0,
        points: 12,
        config: {
          perTurnSeconds: 10,
          rotationBonus: 5,
          seed: "Photosynthesis",
          examples: ["chlorophyll", "sunlight", "glucose"],
        },
      };
    }

    return {
      taskType: type,
      title: `Demo: ${type}`,
      prompt: "Demo task (pool does not include a pre-generated instance for this type yet).",
      timeLimitSeconds: 60,
      points: 10,
    };
  }

  // Start a task from the selected bubble.
  function startSelectedTask() {
    if (!selectedType) return;
    clearReviewLock();
    const next = pickDemoTask(selectedType);
    setCurrentTask({ ...next });
    setPhase("task");
    if ((next?.taskType || next?.type) === TASK_TYPES.ECHO_CHAIN) {
      showToast("Echo Chain! Say it aloud and add one.", true);
      playEchoChime();
    }
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
        if (isPhysicalTask(task)) {
          const delta = randInt(0, 2);
          setTeams((prev) =>
            prev.map((x) => (x.id === bot.id ? { ...x, score: (x.score || 0) + delta } : x))
          );
          return;
        }

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

        const max = typeof task?.points === "number" ? task.points : 10;
        const delta = randInt(Math.floor(max * 0.3), Math.floor(max * 0.9));
        setTeams((prev) =>
          prev.map((x) => (x.id === bot.id ? { ...x, score: (x.score || 0) + delta } : x))
        );
      }, delay);

      botTimersRef.current.push(t);
    });
  }

  useEffect(() => {
    if (phase === "task" && currentTask) simulateBotsForTask(currentTask);
    return () => clearBotTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentTask]);

  // -------------------------
  // Player scoring (objective local; AI via backend)
  // -------------------------
  async function scoreWithBackendAI(task, submission) {
    const json = await fetchJsonSafe(`${API_BASE}/api/ai/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "demo",
        task,
        submission,
      }),
    });

    if (!json?.ok) throw new Error(json?.error || "AI scoring failed");

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

    return { scoreDelta, maxPoints, aiFeedback: json.aiFeedback || json.reason || null, correct: json.correct ?? json.isCorrect ?? null };
  }

  async function handleSubmit(submissionPayload) {
    const task = currentTask;
    if (!task) return;

    if (isPhysicalTask(task)) {
      showToast("Completed (physical task)", true);
      goBackToRunner();
      return;
    }

    let scoreDelta = 0;
    let maxPoints = typeof task?.points === "number" ? task.points : null;

    try {
      const type = task?.taskType || task?.type;

      if (type === TASK_TYPES.NARRATION_SYNTHESIZE) {
        const scored = scoreNarrationLocally(task, submissionPayload);
        scoreDelta = scored.scoreDelta || 0;
        maxPoints = scored.maxPoints ?? maxPoints;
        showToast(
          `Teach-back scored: +${scoreDelta}${maxPoints != null ? `/${maxPoints}` : ""} (avg ${Number(scored.avgRating).toFixed(1)})`,
          true
        );
        // continue with normal flow below (team score update + return to runner)
      } else if (isObjectiveTask(task)) {
        const result = scoreObjectiveLocally(task, submissionPayload);
        scoreDelta = result.scoreDelta || 0;
        maxPoints = result.maxPoints ?? maxPoints;
      } else {
        const ai = await scoreWithBackendAI(task, submissionPayload);
        scoreDelta = ai.scoreDelta || 0;
        maxPoints = ai.maxPoints ?? maxPoints;
        // If backend provided feedback (especially for GuessWho), surface it to the student.
        if (ai.aiFeedback) {
          const ok = ai.correct === true;
          showToast(ai.aiFeedback, ok);
        }
      }
    } catch (e) {
      console.warn("[DemoPage] scoring error:", e);
      showToast(e?.message || "Scoring error", false);
    }

    setTeams((prev) =>
      prev.map((t) => (t.isYou ? { ...t, score: (t.score || 0) + scoreDelta } : t))
    );

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
  // Demo Admin actions (POST regeneration for legacy)
  // -------------------------
  async function onRegeneratePool() {
    // 1st click: reveal the admin input
    if (!showAdminKey) {
      setShowAdminKey(true);
      return;
    }

    // 2nd click: actually regenerate
    const key = adminKey.trim();
    if (!key) return;

    try {
      await regenerateDemoTaskset(key);
      showToast("Demo pool regenerated", true);
    } catch (e) {
      console.warn("[DemoPage] regenerate failed:", e);
      showToast(e?.message || "Regenerate failed", false);
    }
  }

  // -------------------------
  // Simple “StudentApp-like” styling bits
  // -------------------------
  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: "0.8rem",
    fontWeight: 650,
    background: "rgba(15,23,42,0.65)",
    border: "1px solid rgba(148,163,184,0.55)",
    color: "#e5e7eb",
  };

  // -------------------------
  // Render
  // -------------------------
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "radial-gradient(circle at top, #0f172a, #020617)",
        color: "#e5e7eb",
      }}
    >
      {/* HEADER (StudentApp-ish) */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: "1.4rem", color: "#ffffff" }}>
              Curriculate – Demo
            </h1>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "rgba(226,232,240,0.78)" }}>
              Mood → Treasure Runner → Pick a task type. (No room needed.)
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={pill}>
              <span style={{ opacity: 0.9 }}>Mode:</span> <strong>Demo</strong>
            </span>
            <span style={pill}>
              <span style={{ opacity: 0.9 }}>Phase:</span> <strong>{phase}</strong>
            </span>
            <span style={pill}>
              <span style={{ opacity: 0.9 }}>Your score:</span>{" "}
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{yourScore}</strong>
            </span>
            <span style={pill}>
              <span style={{ opacity: 0.9 }}>Teams:</span>{" "}
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{1 + botCount}</strong>
            </span>

            <button
              onClick={onRegeneratePool}
              style={{
                ...pill,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(59,130,246,0.9)", // blue
                color: "#fff",
                fontWeight: 900,
              }}
              title="Regenerate demo pool (admin)"
              type="button"
            >
              Regenerate
            </button>

            {showAdminKey && (
              <input
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Admin code"
                style={{
                  ...pill,
                  padding: "7px 10px",
                  width: 160,
                  textAlign: "left",
                  border: "1px solid rgba(148,163,184,0.55)",
                  background: "rgba(15,23,42,0.65)",
                  color: "#fff",
                  outline: "none",
                }}
              />
            )}

            <div style={{ minWidth: 220 }}>
              <ProgressFillButton
                progress={generating ? progress : 0}
                disabled={generating}
                onClick={startDemoGeneration}
              >
                {generating ? `Regenerating… ${Math.round(progress * 100)}%` : "Regenerate (stream)"}
              </ProgressFillButton>
              <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>{status}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div
          style={{
            marginTop: 10,
            marginBottom: 10,
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
          marginTop: 10,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 900 }}>Leaderboard</div>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Demo pool:{" "}
            <span style={{ fontWeight: 900 }}>{demoTaskset ? "loaded" : "not loaded"}</span>
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
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.55)",
                  background: !selectedType
                    ? "rgba(255,255,255,0.06)"
                    : "linear-gradient(135deg, rgba(34,197,94,0.65), rgba(14,165,233,0.65))",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: !selectedType ? "not-allowed" : "pointer",
                }}
                type="button"
              >
                Start Task
              </button>
            </div>

            <div style={{ marginTop: 10, opacity: 0.78, fontSize: 13 }}>
              Objective tasks score locally. AI-scored tasks call the backend scoring route for{" "}
              <strong>your team</strong>. Bots simulate AI scores.
            </div>
          </div>
        </div>
      )}

      {/* Phase: Task */}
      {phase === "task" && currentTask && (
        <div style={{ marginTop: 16, position: "relative" }}>
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
                  lockTotal > 0
                    ? Math.round((postSubmitSecondsLeft / lockTotal) * 100)
                    : 0;

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
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.55)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
              type="button"
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
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.55)",
                background: "rgba(255,255,255,0.10)",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
              type="button"
            >
              Try again (same type)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
