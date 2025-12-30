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

const DEMO_TEAM_CATALOG = [
  { name: "Alligators", emoji: "🐊", color: "rgba(34,197,94,0.22)" },
  { name: "Lightning Lions", emoji: "🦁", color: "rgba(250,204,21,0.22)" },
  { name: "Cosmic Falcons", emoji: "🦅", color: "rgba(56,189,248,0.22)" },
  { name: "Iron Wolves", emoji: "🐺", color: "rgba(148,163,184,0.22)" },
  { name: "Turbo Turtles", emoji: "🐢", color: "rgba(20,184,166,0.22)" },
  { name: "Fire Dragons", emoji: "🐉", color: "rgba(244,63,94,0.22)" },
  { name: "Shadow Panthers", emoji: "🐆", color: "rgba(168,85,247,0.22)" },
  { name: "Neon Sharks", emoji: "🦈", color: "rgba(59,130,246,0.22)" },
  { name: "Thunder Bears", emoji: "🐻", color: "rgba(251,146,60,0.22)" },
  { name: "Crimson Cobras", emoji: "🐍", color: "rgba(239,68,68,0.22)" },
];

function pickRandomTeamCards(count) {
  const shuffled = [...DEMO_TEAM_CATALOG].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function pickRandomTeamNames(count, exclude = []) {
  const pool = DEMO_TEAM_NAMES.filter((n) => !exclude.includes(n));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
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


  if (type === TASK_TYPES.VENNSORT) {
    // Partial-credit scoring:
    // +2 points for each *required* category included in the student's placement (no credit for extras)
    const cats =
      (Array.isArray(task?.config?.categories) ? task.config.categories : Array.isArray(task?.categories) ? task.categories : [])
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);

    const correct =
      (task?.correctAnswer && typeof task.correctAnswer === "object" && task.correctAnswer) ||
      (task?.config?.correctAnswer && typeof task.config.correctAnswer === "object" && task.config.correctAnswer) ||
      null;

    const placements =
      (submission?.placements && typeof submission.placements === "object" && submission.placements) ||
      (submission?.answer?.placements && typeof submission.answer.placements === "object" && submission.answer.placements) ||
      {};

    if (!correct) {
      return { scoreDelta: 0, maxPoints: points, correct: false, details: { reason: "missing-correctAnswer" } };
    }

    const norm = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map(String)
        .map((s) => s.trim())
        .filter((c) => c && cats.includes(c))
        .sort();

    let maxPoints = 0;
    let scoreDelta = 0;

    for (const [itemId, expectedRaw] of Object.entries(correct)) {
      const expected = norm(expectedRaw);
      const got = norm(placements?.[itemId]);
      maxPoints += expected.length * 2;

      // credit for each required category present
      const expectedSet = new Set(expected);
      let hit = 0;
      for (const g of got) {
        if (expectedSet.has(g)) hit += 1;
      }
      scoreDelta += hit * 2;
    }

    return {
      scoreDelta: clamp(scoreDelta, 0, maxPoints),
      maxPoints: Math.max(0, maxPoints),
      correct: scoreDelta >= maxPoints && maxPoints > 0,
      details: { mode: "per-category", cats },
    };
  }


  if (type === TASK_TYPES.VENNSORT) {
    const cats =
      (Array.isArray(task?.config?.categories) ? task.config.categories : Array.isArray(task?.categories) ? task.categories : [])
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);

    const rawItems = Array.isArray(task?.config?.items)
      ? task.config.items
      : Array.isArray(task?.items)
      ? task.items
      : Array.isArray(task?.options)
      ? task.options
      : [];

    const makeId = (it, idx) =>
      (it && typeof it === "object" ? it.id ?? it._id ?? it.key : null) ||
      (typeof it === "string" ? it : null) ||
      `item-${idx}`;

    const placements = {};
    rawItems.slice(0, 10).forEach((it, idx) => {
      const id = String(makeId(it, idx));
      const pickCount = cats.length ? randInt(0, Math.min(2, cats.length)) : 0;
      const chosen = [];
      for (let k = 0; k < pickCount; k++) {
        const c = cats[randInt(0, cats.length - 1)];
        if (!chosen.includes(c)) chosen.push(c);
      }
      placements[id] = chosen;
    });

    return { placements };
  }

  if (type === TASK_TYPES.SPEED_DRAW) {
    return { answer: { done: true, note: "We played a quick round and guessed!" } };
  }

  if (type === TASK_TYPES.HIDENSEEK) {
    return {
      answer: {
        text: "We found the target, took a photo, and explained why it matters.",
        hasPhoto: true,
      },
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
function playScriptPlayChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/foley/page_turn.ogg");
    a.volume = 0.16;
    a.play();
  } catch {
    // ignore
  }
}

function playRolePlayChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/foley/card_shuffle.ogg");
    a.volume = 0.16;
    a.play();
  } catch {
    // ignore
  }
}

function playWordWeaverChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/foley/wood_tap.ogg");
    a.volume = 0.14;
    a.play();
  } catch {
    // ignore
  }
}

function playDebateGavel() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/foley/wood_tap.ogg");
    a.volume = 0.18;
    a.play();
  } catch {
    // ignore
  }
}


function playPhotoShutter() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/camera/camera_shutter_click_01.ogg");
    a.volume = 0.18;
    a.play();
  } catch {
    // ignore
  }
}

function playSketchChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/foley/marker_write.ogg");
    a.volume = 0.14;
    a.play();
  } catch {
    // ignore
  }
}

function playVennTap() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/foley/wood_tap.ogg");
    a.volume = 0.12;
    a.play();
  } catch {
    // ignore
  }
}

function playHuntWhoosh() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/cartoon/slide_whistle_to_drum_hit.ogg");
    a.volume = 0.12;
    a.play();
  } catch {
    // ignore
  }
}


function playFakeOutChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg");
    a.volume = 0.14;
    a.play();
  } catch {
    // ignore
  }
}

// Universal (demo) submit feedback SFX
function playCorrectChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg");
    a.volume = 0.16;
    a.play();
  } catch {
    // ignore
  }
}

function playWrongChime() {
  try {
    const a = new Audio("https://actions.google.com/sounds/v1/cartoon/boing.ogg");
    a.volume = 0.14;
    a.play();
  } catch {
    // ignore
  }
}


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
    const botCards = pickRandomTeamCards(3);

    return [
      {
        id: "team-you",
        teamName: "Your Team",
        emoji: "⭐️",
        color: "rgba(59,130,246,0.24)", // your team blue
        isYou: true,
        score: 0,
      },
      ...botCards.map((c, i) => ({
        id: `team-bot-${i + 1}`,
        teamName: c.name,
        emoji: c.emoji,
        color: c.color,
        isYou: false,
        score: 0,
      })),
    ];
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

    // ScriptPlay: rich fallback so TaskRunner can render it in demo mode.
    if (type === TASK_TYPES.SCRIPT_PLAY) {
      return {
        taskType: TASK_TYPES.SCRIPT_PLAY,
        title: "Script Play",
        prompt:
          "Pass the device speaker-to-speaker. Read your lines with the tone cues. Add a little acting for bonus points!",
        timeLimitSeconds: 120,
        points: 14,
        config: {
          sceneTitle: "The Lost Map",
          setting: "A candlelit library, late at night",
          roles: ["Narrator", "Ava", "Noah"],
          beats: [
            {
              speaker: "Narrator",
              cue: "Calm, mysterious",
              lines: [
                "The old library creaks as a storm taps the windows.",
                "Ava finds a folded map hidden inside a dusty book."
              ],
              before: "You are setting the scene.",
              after: "Hand the device to Ava."
            },
            {
              speaker: "Ava",
              cue: "Whispering, excited",
              stageDirections: ["(leans in)", "(speaks softly)"],
              lines: [
                "Noah… look. This map has today’s date on it.",
                "Why would someone hide it here?"
              ],
              before: "You just discovered something important.",
              after: "Hand the device to Noah."
            },
            {
              speaker: "Noah",
              cue: "Skeptical but curious",
              stageDirections: ["(raises an eyebrow)"],
              lines: [
                "Either it’s a prank… or it’s a clue.",
                "Let’s follow it—carefully."
              ],
              before: "Respond to Ava and decide what to do.",
              after: "Group: act out the next step together."
            }
          ],
          scoring: { expressiveBonus: true, maxExpressiveBonus: 4 }
        },
      };
    }

    // RolePlayDeck: rich fallback so TaskRunner can render it in demo mode.
    if (type === TASK_TYPES.ROLE_PLAY_DECK || type === "role-play-deck") {
      return {
        taskType: TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck",
        title: "RolePlay Deck",
        prompt:
          "Choose Mystery (hidden roles) or Classic (open roles). Each player draws ONE role card, then role-play the scenario as a team. Tap Finished when done.",
        timeLimitSeconds: 180,
        points: 12,
        config: {
          mode: "choose",
          roles: [
            {
              name: "Amira",
              role: "Community helper",
              characteristics: ["Kind", "Truthful", "Brave", "Patient"],
            },
            {
              name: "Noah",
              role: "Question-asker",
              characteristics: ["Curious", "Respectful", "Careful thinker", "Fair"],
            },
            {
              name: "Sofia",
              role: "Peacemaker",
              characteristics: ["Empathetic", "Calm", "Listening", "Humble"],
            },
            {
              name: "Eli",
              role: "Planner",
              characteristics: ["Wise", "Organized", "Self-controlled", "Honest"],
            },
          ],
          scenario:
            "Your class is planning a new rule for fair group work. Act out a meeting where each role helps decide what the rule should be and why it matters.",
        },
      };
    }



    // Word Weaver Duel: rich fallback (Scrabble-style words on grid)
    if (type === TASK_TYPES.WORD_WEAVER_DUEL || type === "word-weaver-duel") {
      return {
        taskType: TASK_TYPES.WORD_WEAVER_DUEL,
        title: "Word Weaver Duel",
        prompt:
          "Take turns placing whole words onto the grid (horizontal or vertical). Try to intersect existing letters for bonus points.",
        timeLimitSeconds: 180,
        points: 18,
        mode: "scrabble",
        gridSize: 11,
        words: ["anchor", "harbor", "navigate", "compass", "current", "voyage", "island", "tide"],
        turnkeeper: { playerCount: 4, perTurnSeconds: 12 },
      };
    }

    // Flashcards Race: rich fallback so TaskRunner can render it in demo mode.
    if (type === TASK_TYPES.FLASHCARDS_RACE) {
      return {
        taskType: TASK_TYPES.FLASHCARDS_RACE,
        title: "Flashcards Race",
        prompt:
          "Buzz in first, answer fast, and win the card. (Demo mode runs locally; live mode uses inter-team events.)",
        timeLimitSeconds: 0,
        points: 15,
        demoMode: true,
        cards: [
          { question: "What is 7 × 8?", answer: "56" },
          { question: "Who discovered gravity (classic story)?", answer: "Isaac Newton" },
          { question: "Define 'ecosystem'.", answer: "A community of living organisms interacting with their environment." },
          { question: "What is the capital of Canada?", answer: "Ottawa" },
          { question: "What is π to 2 decimals?", answer: "3.14" },
          { question: "Name the first book of the Bible.", answer: "Genesis" }
        ],
      };
    }


    // AI Debate Judge: rich fallback (special live-debate verdict tool)
    if (type === TASK_TYPES.AI_DEBATE_JUDGE || type === "ai-debate-judge" || type === "ai_debate_judge") {
      return {
        taskType: TASK_TYPES.AI_DEBATE_JUDGE,
        title: "AI Debate Judge",
        prompt:
          "Choose your side and role, then tap 1‑2‑3 GO to record. Use evidence, structure, and respectful tone.",
        timeLimitSeconds: 0,
        points: 0,
        config: {
          kind: "ai-debate-judge",
          allowTeamDevice: true,
          sides: ["Affirmative", "Negative"],
          positions: ["Introduction", "First", "Rebuttal", "Conclusion"],
          timing: {
            countdownSeconds: 120,
            graceSeconds: 15,
            penaltyTooShortUnderSeconds: 105,
            penaltyTooLongOverSeconds: 135,
            hardStopSeconds: 150,
          },
          ui: {
            showSoundMeter: true,
            showWaveform: false,
            showListeningIndicator: true,
          },
          scoring: {
            rubricName: "Debate Speech Rubric",
            categories: [
              { id: "structure", label: "Structure & Clarity", weight: 0.25 },
              { id: "evidence", label: "Evidence & Reasoning", weight: 0.35 },
              { id: "rebuttal", label: "Rebuttal & Responsiveness", weight: 0.20 },
              { id: "delivery", label: "Delivery & Respect", weight: 0.20 },
            ],
          },
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
    if ((next?.taskType || next?.type) === TASK_TYPES.SCRIPT_PLAY) {
      showToast("🎭 Script Play! Pass the device speaker-to-speaker.", true);
      playScriptPlayChime();
    }
    if ((next?.taskType || next?.type) === TASK_TYPES.ECHO_CHAIN) {
      showToast("Echo Chain! Say it aloud and add one.", true);
      playEchoChime();
    }
    if ((next?.taskType || next?.type) === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck")) {
      showToast("🎭 RolePlay Deck! Draw roles, then act it out.", true);
      playRolePlayChime();
    }
  
    if ((next?.taskType || next?.type) === TASK_TYPES.WORD_WEAVER_DUEL) {
      showToast("🧩 Word Weaver Duel! Take turns placing words for points.", true);
      playWordWeaverChime();
    }

    if ((next?.taskType || next?.type) === TASK_TYPES.FLASHCARDS_RACE) {
      showToast("🔔 Flashcards Race! Buzz in and answer fast.", true);
      playFakeOutChime();
    }

    if ((next?.taskType || next?.type) === TASK_TYPES.VENNSORT) {
      showToast("⭕ Venn Sort! Drag items into the correct Venn regions.", true);
      playVennTap();
    }

    if ((next?.taskType || next?.type) === TASK_TYPES.SPEED_DRAW) {
      showToast("✏️ Speed Draw! One draws, teammates guess fast.", true);
      playSketchChime();
    }

    if (
      (next?.taskType || next?.type) === TASK_TYPES.PHOTO ||
      (next?.taskType || next?.type) === TASK_TYPES.PHOTO_JOURNAL
    ) {
      showToast("📸 Photo challenge! Take a clear pic, then add your explanation.", true);
      playPhotoShutter();
    }

    if ((next?.taskType || next?.type) === TASK_TYPES.HIDENSEEK) {
      showToast("🔎 Hide & Seek! Find it, snap proof, and explain why it matters.", true);
      playHuntWhoosh();
    }

    if ((next?.taskType || next?.type) === TASK_TYPES.AI_DEBATE_JUDGE) {
      showToast("🧑‍⚖️ AI Debate Judge! Pick your side & role, then record your speech.", true);
      playDebateGavel();
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
    let wasCorrect = null; // true/false/null

    try {
      const type = task?.taskType || task?.type;

      
      if (type === TASK_TYPES.WORD_WEAVER_DUEL) {
        // Local scoring: use the task's own computed score payload.
        if (submissionPayload?.mode === "phrase") {
          const phrase = String(task?.targetPhrase ?? task?.phrase ?? task?.solution ?? "").trim();
          const ans = String(submissionPayload?.answer ?? "").trim();
          const ok = phrase && ans && phrase.toLowerCase() === ans.toLowerCase();
          scoreDelta = ok ? (typeof task?.points === "number" ? task.points : 12) : 0;
          maxPoints = typeof task?.points === "number" ? task.points : maxPoints;
          wasCorrect = ok;
          showToast(ok ? "Correct phrase! ✨" : "Submitted ✍️", ok);
        } else {
          const scoresObj = submissionPayload?.scores && typeof submissionPayload.scores === "object" ? submissionPayload.scores : {};
          const totalPts = Object.values(scoresObj).reduce((sum, v) => sum + (Number(v) || 0), 0);
          scoreDelta = totalPts;
          maxPoints = null;
          wasCorrect = totalPts > 0;
          showToast(`Placed words scored: +${totalPts}`, true);
        }
      } else if (type === TASK_TYPES.FLASHCARDS_RACE) {
        // Demo/local scoring: if your team wins, award full task points; otherwise 0.
        const w = submissionPayload?.answer?.winner;
        const youWon =
          (w && typeof w === "object" && (w.teamId === "team-you" || w.teamName === "Your Team")) ||
          (typeof w === "string" && String(w).toLowerCase().includes("your")) ||
          ((submissionPayload?.answer?.scores?.you ?? 0) >= (submissionPayload?.answer?.scores?.other ?? Infinity));

        scoreDelta = youWon ? (typeof task?.points === "number" ? task.points : 15) : 0;
        maxPoints = typeof task?.points === "number" ? task.points : maxPoints;
        wasCorrect = youWon;
        showToast(youWon ? "You won the race! 🏁" : "Race complete! 🏁", youWon);
      } else
if (type === TASK_TYPES.NARRATION_SYNTHESIZE) {
        const scored = scoreNarrationLocally(task, submissionPayload);
        scoreDelta = scored.scoreDelta || 0;
        maxPoints = scored.maxPoints ?? maxPoints;
        // treat "correct" as "earned meaningful points"
        wasCorrect = scoreDelta > 0;
        showToast(
          `Teach-back scored: +${scoreDelta}${maxPoints != null ? `/${maxPoints}` : ""} (avg ${Number(scored.avgRating).toFixed(1)})`,
          true
        );
        // continue with normal flow below (team score update + return to runner)
      } else if (isObjectiveTask(task)) {
        const result = scoreObjectiveLocally(task, submissionPayload);
        scoreDelta = result.scoreDelta || 0;
        maxPoints = result.maxPoints ?? maxPoints;
        wasCorrect = result.correct === true;
      } else {
        const ai = await scoreWithBackendAI(task, submissionPayload);
        scoreDelta = ai.scoreDelta || 0;
        maxPoints = ai.maxPoints ?? maxPoints;
        if (typeof ai.correct === "boolean") wasCorrect = ai.correct;
        else wasCorrect = scoreDelta > 0;
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

    // Consistent Curriculate feedback (SFX) – especially noticeable on core Q&A tasks.
    if (wasCorrect === true || scoreDelta > 0) playCorrectChime();
    else playWrongChime();

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

  const instructionPill = {
    ...pill,
    cursor: "pointer",
    userSelect: "none",
    padding: "8px 12px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    fontWeight: 900,
    lineHeight: 1.25,
    maxWidth: 820,
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
            <button
              type="button"
              onClick={() =>
                showToast(
                  "Instructions copied above — Usual play: Room Code → Mood → Treasure Runner → Tasks → Leaderboard. Demo: Try Runner → Pick a task type → Try as many as you like.",
                  true
                )
              }
              style={instructionPill}
              title="Quick instructions"
            >
              <span style={{ opacity: 0.9, marginRight: 8 }}>Instructions:</span>
              <span style={{ opacity: 0.95 }}>
                Usual play: <strong>Enter Room Code</strong> + Team members → <strong>Mood</strong> →
                <strong> Treasure Runner</strong> (while waiting for Launch) → <strong>Enjoy tasks</strong> →
                <strong> See leaderboard</strong>
                <span style={{ opacity: 0.85 }}> &nbsp;•&nbsp; </span>
                For the Demo: <strong>Try Treasure Runner</strong> (for fun) → <strong>Pick a task type</strong> →
                <strong> Try as many as you like</strong>
              </span>
            </button>
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

            <a
              href="https://www.curriculate.net/freetrial"
              target="_blank"
              rel="noreferrer"
              style={{
                ...pill,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(34,197,94,0.22)",
                color: "#fff",
                fontWeight: 900,
                textDecoration: "none",
              }}
              title="Start a free trial"
            >
              Free Trial
            </a>

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

            {/* Demo helper: simulate a station scan (no camera in demo) */}
            {((currentTask?.taskType || currentTask?.type) === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.45)",
                  background: "rgba(15,23,42,0.55)",
                  color: "#e5e7eb",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8 }}>
                  Demo: tap a station color to simulate scanning that QR
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["Red","Orange","Yellow","Green","Blue","Teal","Purple","Pink"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        try {
                          window.dispatchEvent(
                            new CustomEvent("curriculate:stationScan", {
                              detail: { color: c.toLowerCase(), stationColor: c.toLowerCase() },
                            })
                          );
                        } catch {}
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.10)",
                        color: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                  In real sessions, students scan the classroom’s fixed colored QR stations.
                </div>
              </div>
            )}

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