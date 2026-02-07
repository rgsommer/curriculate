// student-app/src/pages/DemoPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskRunner from "../components/tasks/TaskRunner.jsx";
import { TASK_TYPES, TASK_TYPE_META, getTaskTypeMeta, normalizeTaskType } from "../../../shared/taskTypes.js";
import ProgressFillButton from "../components/ProgressFillButton";

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.curriculate.net";

// Demo intro video (served from student-app/public)
const DEMO_INTRO_SOURCES = ["/demointro/demo-intro.mp4", "/demointro/demo-intro-alt.mp4"];

// Demo pacing
const DEFAULT_REVIEW_SECONDS = 15;
const BOT_THINK_MIN_MS = 900;
const BOT_THINK_MAX_MS = 2200;

// Physical tasks: derive from TaskTypes (category === movement) + keep a couple of legacy aliases.
const PHYSICAL_TYPES = new Set(
  Object.entries(TASK_TYPE_META || {})
    .filter(([, meta]) => String(meta?.category || "").toLowerCase() === "movement")
    .map(([t]) => String(t).toLowerCase())
    .concat(
      [TASK_TYPES.MAD_DASH_SEQUENCE].filter(Boolean).map((s) => String(s).toLowerCase())
    )
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

function getMetaForTask(taskOrType) {
  const type = normalizeTaskType(taskOrType?.taskType || taskOrType?.type || taskOrType);
  return getTaskTypeMeta(type) || (TASK_TYPE_META?.[type] || {});
}

function isObjectiveTask(task) {
  const meta = getMetaForTask(task);

  // New switches (preferred)
  if (meta.scoringMode) return String(meta.scoringMode).toLowerCase() === "objective";
  if (typeof meta.objectiveKeyed === "boolean") return meta.objectiveKeyed === true;

  // Back-compat (older meta)
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


// Viewport-wide card: 80% of viewport width (centered), with rounded corners.
function ViewportCard({ children, padded = true }) {
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", marginTop: 16 }}>
      <div
        style={{
          width: "80vw",
          maxWidth: 1200,
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.85)",
          boxShadow: "0 18px 60px rgba(15, 23, 42, 0.10)",
        }}
      >
        <div style={{ padding: padded ? 16 : 0 }}>{children}</div>
      </div>
    </div>
  );
}

export default function DemoPage() {

  const INTRO_PLAYED_KEY = "curriculate.demoIntroPlayed.v1";
  const MOOD_PLAYED_KEY = "curriculate.moodCheckPlayed.v1";

  // Pick one of the two intro variants once per page load (stable; prevents mid-play “flash”)
  const demoIntroSrc = useMemo(() => {
    const pickAlt = Math.random() >= 0.5;
      return DEMO_INTRO_SOURCES[pickAlt ? 1 : 0] || DEMO_INTRO_SOURCES[0];
    }, []);
    const [phase, setPhase] = useState(() => {
      try {
        return sessionStorage.getItem(MOOD_PLAYED_KEY) === "1" ? "runner" : "mood";
      } catch {
        return "mood";
      }
  }); // mood | runner | task
  const [demoTaskset, setDemoTaskset] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);

  const [selectedType, setSelectedType] = useState("");
  const [currentTask, setCurrentTask] = useState(null);

  const [taskLocked, setTaskLocked] = useState(false);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const postSubmitTimerRef = useRef(null);

  
  const lockAnimRef = useRef(null);
  const lockStartRef = useRef(null);
  const [lockProgress, setLockProgress] = useState(0); // 0..1
const [toast, setToast] = useState(null);

  // BodyBreak demo flourish
  const [bodyBreakGo, setBodyBreakGo] = useState(false);
  const [bodyBreakPuff, setBodyBreakPuff] = useState(false);
  const audioCtxRef = useRef(null);


// BodyBreak demo flourish helpers (must be inside component to access state/hooks safely)
const getDemoAudioCtx = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    // keep a single context per tab to avoid repeated permission prompts / resource churn
    if (!window.__curriculateDemoAudioCtx) window.__curriculateDemoAudioCtx = new Ctx();
    return window.__curriculateDemoAudioCtx;
  } catch {
    return null;
  }
};

function playGoBeep() {
  try {
    const ctx = getDemoAudioCtx();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    const t0 = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.start(t0);
    o.stop(t0 + 0.2);
  } catch {
    // ignore
  }
}

function playPuffPop() {
  try {
    const ctx = getDemoAudioCtx();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 660;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    const t0 = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.10, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    o.start(t0);
    o.stop(t0 + 0.16);
  } catch {
    // ignore
  }
}

function triggerBodyBreakGo() {
  setBodyBreakGo(true);
  window.setTimeout(() => setBodyBreakGo(false), 520);
}

function triggerBodyBreakPuff() {
  setBodyBreakPuff(true);
  window.setTimeout(() => setBodyBreakPuff(false), 900);
}

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

  const [introReady, setIntroReady] = useState(false);
  const [introVisible, setIntroVisible] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(false);
  const introStageHeight = 420;

  // show only once per tab session
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return sessionStorage.getItem(INTRO_PLAYED_KEY) !== "1";
    } catch {
      return true; // if storage blocked, fall back to showing
    }
  });

  // Reset the animated intro state whenever showIntro becomes true
  useEffect(() => {
    if (showIntro) {
      setIntroVisible(false);
      setIntroPlaying(false);
    }
  }, [showIntro]);

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
        if (lockAnimRef.current) {
      cancelAnimationFrame(lockAnimRef.current);
      lockAnimRef.current = null;
    }
setTaskLocked(false);
    setPostSubmitSecondsLeft(null);
  
    setLockProgress(0);
}

  function goBackToRunner() {
    clearReviewLock();
    setPhase("runner");
    setCurrentTask(null);
  }

  // -------------------------
  // Demo pool IO
  // -------------------------

  const loadDemoTaskset = async () => {
    const keysToTry = ["demoTaskset:v1", "demoTaskset:v3", "demoTaskset:latest"];

    // Try multiple known keys to avoid hard failure when backend rotates versions.
    for (const key of keysToTry) {
      try {
        const url = `${API_BASE}/api/demo/taskset?key=${encodeURIComponent(key)}`;
        const data = await fetchJsonSafe(url, { credentials: "include" });

        // Normalize possible shapes.
        const taskset = data?.taskset || data?.taskSet || data;
        const tasks = taskset?.tasks || taskset?.items || taskset?.taskset || [];

        if (Array.isArray(tasks) && tasks.length) {
          setDemoTaskset({ key, tasks, raw: taskset });
          return;
        }
      } catch {
        // try next key
      }
    }

    // Could not load; keep demo playable with local templates.
    setDemoTaskset(null);
  };

  useEffect(() => {
    // Load once on mount.
    loadDemoTaskset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildDemoTask(taskType) {
    const meta = getTaskTypeMeta(taskType);

    // Prefer remote task if available.
    const remote = demoTaskset?.tasks?.find(
      (t) => normalizeTaskType(t?.taskType) === normalizeTaskType(taskType)
    );
    if (remote) return remote;

    // Otherwise, use TaskTypes-provided demo template.
    const tpl = meta?.demoTemplate;
    if (typeof tpl === "function") return tpl();
    if (tpl && typeof tpl === "object") return { ...tpl };

    // Last resort: a minimal multiple-choice shell.
    return {
      taskType: normalizeTaskType(taskType) || TASK_TYPES.MULTIPLE_CHOICE || "multiple-choice",
      title: meta?.label || "Demo Task",
      prompt: "Demo task (template missing).",
      items: [
        { id: "i1", prompt: "Placeholder question", options: ["A", "B"], correctAnswer: 0 },
      ],
      config: { items: [
        { id: "i1", prompt: "Placeholder question", options: ["A", "B"], correctAnswer: 0 },
      ] },
    };
  }

  function startSelectedTask(taskType) {
    const type = normalizeTaskType(taskType);
    if (!type) return;

    clearReviewLock();

    const meta = getTaskTypeMeta(type);
    const task = buildDemoTask(type);

    // Optional toast/sfx hooks sourced from TaskTypes.
    if (meta?.demoToast) showToast(meta.demoToast, true);
    if (meta?.demoSfx === "goBeep") playGoBeep();

    // BodyBreak: tiny flourish when starting.
    if (normalizeTaskType(type) === normalizeTaskType(TASK_TYPES.BODY_BREAK)) {
      triggerBodyBreakGo();
      playGoBeep();
    }

    setSelectedType(type);
    setCurrentTask(task);
    setPhase("task");
  }

  function onTaskSubmitted() {
    // Lock review briefly (prevents spam + makes demo feel paced)
    setTaskLocked(true);
    setPostSubmitSecondsLeft(DEFAULT_REVIEW_SECONDS);

    // smooth progress bar over the lock window
    lockStartRef.current = performance.now();
    const totalMs = DEFAULT_REVIEW_SECONDS * 1000;

    const tick = () => {
      const now = performance.now();
      const t = Math.min(1, (now - (lockStartRef.current || now)) / totalMs);
      setLockProgress(t);
      if (t < 1) {
        lockAnimRef.current = requestAnimationFrame(tick);
      }
    };
    lockAnimRef.current = requestAnimationFrame(tick);

    if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);
    postSubmitTimerRef.current = setInterval(() => {
      setPostSubmitSecondsLeft((s) => {
        const next = (s ?? 0) - 1;
        if (next <= 0) {
          clearReviewLock();
          return null;
        }
        return next;
      });
    }, 1000);

    // Award score to a random team for fun.
    setTeams((prev) => {
      const pick = Math.floor(Math.random() * prev.length);
      return prev.map((t, idx) => (idx === pick ? { ...t, score: (t.score || 0) + 1 } : t));
    });

    // BodyBreak completion puff.
    if (normalizeTaskType(selectedType) === normalizeTaskType(TASK_TYPES.BODY_BREAK)) {
      triggerBodyBreakPuff();
      playPuffPop();
    }
  }

  const demoTypes = useMemo(() => {
    return Object.entries(TASK_TYPE_META || {})
      .filter(([, meta]) => meta?.demoEligible)
      .map(([t, meta]) => ({ type: t, meta }))
      .sort((a, b) => String(a.meta?.label || a.type).localeCompare(String(b.meta?.label || b.type)));
  }, []);

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeSearch, setTypeSearch] = useState("");

  const demoCategories = useMemo(() => {
    const set = new Set();
    for (const { meta } of demoTypes) {
      const c = String(meta?.category || "other").trim() || "other";
      set.add(c);
    }
    return ["all", ...Array.from(set).sort((a, b) => String(a).localeCompare(String(b)))];
  }, [demoTypes]);

  const filteredDemoTypes = useMemo(() => {
    const q = String(typeSearch || "").trim().toLowerCase();
    return demoTypes.filter(({ type, meta }) => {
      const cat = String(meta?.category || "other").trim() || "other";
      if (categoryFilter !== "all" && cat !== categoryFilter) return false;
      if (!q) return true;
      const label = String(meta?.label || type).toLowerCase();
      return label.includes(q) || String(type).toLowerCase().includes(q) || cat.toLowerCase().includes(q);
    });
  }, [demoTypes, categoryFilter, typeSearch]);

  // -------------------------
  // Render
  // -------------------------
  if (phase === "mood") {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Curriculate Demo</h1>
        <p style={{ marginTop: 10, maxWidth: 760 }}>
          Quick mood check so the demo flow matches your classroom energy.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button
            onClick={() => {
              try { sessionStorage.setItem(MOOD_PLAYED_KEY, "1"); } catch {}
              setPhase("runner");
            }}
          >
            Let’s go
          </button>
        </div>
      </div>
    );
  }

  if (phase === "task" && currentTask) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={goBackToRunner}>← Back</button>
          <div style={{ fontWeight: 700 }}>{getTaskTypeMeta(selectedType)?.label || selectedType}</div>
          {taskLocked && (
            <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
              Next task in {postSubmitSecondsLeft}s
            </div>
          )}
        </div>

        {taskLocked && (
          <div style={{ height: 8, background: "rgba(255,255,255,0.12)", borderRadius: 999, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", width: `${Math.round(lockProgress * 100)}%`, background: "rgba(59,130,246,0.9)" }} />
          </div>
        )}

        <TaskRunner
          task={currentTask}
          socket={demoSocket}
          demoMode={true}
          // Some task components call these; safe no-ops.
          onSubmit={onTaskSubmitted}
          onComplete={onTaskSubmitted}
          onDone={onTaskSubmitted}
          setShowInstructions={setShowInstructions}
        />

        {toast && (
          <div
            style={{
              position: "fixed",
              left: "50%",
              bottom: 18,
              transform: "translateX(-50%)",
              padding: "10px 14px",
              borderRadius: 14,
              background: toast.positive ? "rgba(34,197,94,0.92)" : "rgba(239,68,68,0.92)",
              color: "#fff",
              fontWeight: 700,
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            }}
          >
            {toast.message}
          </div>
        )}

        {/* BodyBreak flourish */}
        {(bodyBreakGo || bodyBreakPuff) && (
          <div style={{ position: "fixed", inset: 0, pointerEvents: "none", display: "grid", placeItems: "center" }}>
            {bodyBreakGo && (
              <div style={{ fontSize: 64, fontWeight: 900, transform: "rotate(-4deg)" }}>GO!</div>
            )}
            {bodyBreakPuff && (
              <div style={{ fontSize: 56, opacity: 0.9 }}>🎉</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // runner
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Demo Task Runner</h1>
      <p style={{ marginTop: 10, maxWidth: 900 }}>
        Choose a task type. Templates and labels come from <code>shared/taskTypes.js</code>.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "14px 0" }}>
        <ProgressFillButton
          disabled={generating}
          progress={progress}
          onClick={() => {
            // Keep existing UI element but do not start SSE in this minimal drop-in.
            showToast("Demo generator is handled elsewhere in your app.", false);
          }}
        >
          Generate all types
        </ProgressFillButton>

        <button
          onClick={() => {
            setDemoTaskset(null);
            loadDemoTaskset();
          }}
        >
          Reload demo taskset
        </button>

        {demoTaskset?.key && (
          <span style={{ fontSize: 12, opacity: 0.75 }}>Loaded: {demoTaskset.key}</span>
        )}
      </div>

            <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14, alignItems: "start" }}>
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Categories</div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {demoCategories.map((c) => {
              const active = c === categoryFilter;
              return (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 999,
                    border: active ? "1px solid rgba(59,130,246,0.55)" : "1px solid rgba(255,255,255,0.14)",
                    background: active ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    fontWeight: 800,
                    fontSize: 12,
                    textTransform: "capitalize",
                  }}
                >
                  {c === "all" ? "All" : c}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Search</div>
            <input
              value={typeSearch}
              onChange={(e) => setTypeSearch(e.target.value)}
              placeholder="Type a task name…"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(0,0,0,0.18)",
                color: "#fff",
                outline: "none",
              }}
            />
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              Showing <b>{filteredDemoTypes.length}</b> of <b>{demoTypes.length}</b>
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            padding: 12,
            maxHeight: "70vh",
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 800 }}>Tasks</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Tip: click a task to launch it
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
            {filteredDemoTypes.map(({ type, meta }) => (
              <button
                key={type}
                onClick={() => startSelectedTask(type)}
                style={{
                  textAlign: "left",
                  padding: 14,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 800 }}>{meta?.label || type}</div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  {meta?.category ? `Category: ${meta.category}` : ""}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                  {meta?.implemented ? "Implemented" : "Not implemented"}
                  {meta?.demoEligible ? " • Demo" : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 18,
            transform: "translateX(-50%)",
            padding: "10px 14px",
            borderRadius: 14,
            background: toast.positive ? "rgba(34,197,94,0.92)" : "rgba(239,68,68,0.92)",
            color: "#fff",
            fontWeight: 700,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
