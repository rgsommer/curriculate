// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import QrScanner from "./components/QrScanner.jsx";
import NoiseSensor from "./components/NoiseSensor.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import MoodCheckInTask from "./components/tasks/types/MoodCheckInTask";
import TreasureRunner from "./components/tasks/types/TreasureRunner";

import { API_BASE_URL } from "./config.js";
import { COLORS } from "@shared/colors.js";
import AnimatedLeaderboard from "./components/Leaderboard.jsx";

// Build marker so you can confirm the deployed bundle
console.log("STUDENT BUILD MARKER v2025-12-12-AI, API_BASE_URL:", API_BASE_URL);

// ---------------------------------------------------------------------
// Station colour helpers – numeric ids (station-1, station-2…)
// ---------------------------------------------------------------------
const COLOR_NAMES = COLORS;

// For now, LiveSession-launched tasks are assumed to use "Classroom"
const DEFAULT_LOCATION = "Classroom";

const DEFAULT_POST_SUBMIT_SECONDS = 15;

// --- MATCHING reveal helper (student review overlay) ---
// --- MATCHING reveal helper (student review overlay) ---
function buildMatchingReveal(task, reviewState) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const correctMatches =
    (reviewState && typeof reviewState.correctMatches === "object" && reviewState.correctMatches) ||
    (cfg && typeof cfg.correctMatches === "object" && cfg.correctMatches) ||
    (task && typeof task.correctMatches === "object" && task.correctMatches) ||
    null;

  if (!correctMatches) return null;

  // Student submission map (we saved it in reviewState.studentAnswer on submit)
  const studentRaw = reviewState?.studentAnswer;
  const studentMatches =
    (studentRaw && typeof studentRaw.matches === "object" && studentRaw.matches) ||
    (studentRaw && typeof studentRaw.pairs === "object" && studentRaw.pairs) ||
    (studentRaw && typeof studentRaw.correctMatches === "object" && studentRaw.correctMatches) ||
    null;

  const leftItems = Array.isArray(reviewState?.leftItems)
    ? reviewState.leftItems
    : Array.isArray(cfg?.leftItems)
    ? cfg.leftItems
    : Array.isArray(task?.leftItems)
    ? task.leftItems
    : [];

  const rightItems = Array.isArray(reviewState?.rightItems)
    ? reviewState.rightItems
    : Array.isArray(cfg?.rightItems)
    ? cfg.rightItems
    : Array.isArray(task?.rightItems)
    ? task.rightItems
    : [];

  const leftTextById = {};
  for (const it of leftItems) {
    const id = String(it?.id ?? "");
    const text = String(it?.text ?? it?.label ?? it ?? "").trim();
    if (id && text) leftTextById[id] = text;
  }

  const rightTextById = {};
  for (const it of rightItems) {
    const id = String(it?.id ?? "");
    const text = String(it?.text ?? it?.label ?? it ?? "").trim();
    if (id && text) rightTextById[id] = text;
  }

  let correctCount = 0;
  const entries = Object.entries(correctMatches);

  const rows = entries.map(([l, r]) => {
    const leftId = String(l);
    const rightId = String(r);

    const left = leftTextById[leftId] || leftId;
    const right = rightTextById[rightId] || rightId;

    const studentRight = studentMatches?.[leftId] != null ? String(studentMatches[leftId]) : null;

    const isAnswered = studentRight != null;
    const isCorrect = isAnswered && studentRight === rightId;

    if (isCorrect) correctCount += 1;

    const studentRightText =
      studentRight != null ? (rightTextById[String(studentRight)] || String(studentRight)) : null;

    return {
      leftId,
      rightId,
      left,
      right,
      studentRight,
      studentRightText,
      isAnswered,
      isCorrect,
    };
  });

  const totalPairs = entries.length || 1;
  const percent = Math.round((correctCount / totalPairs) * 100);

  return { rows, correctCount, totalPairs, percent };
}

// Normalize a human-readable location into a slug like "room-12"
function normalizeLocationSlug(raw) {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeStationId(raw) {
  if (!raw) {
    return { id: null, color: null, label: "Not assigned yet" };
  }

  const s = String(raw).trim();
  let lower = s.toLowerCase();

  // Case 1: full numeric id: "station-1", "station-2", ...
  let m = /^station-(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    return {
      id: `station-${m[1]}`,
      color,
      label: color
        ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
        : `Station-${m[1]}`,
    };
  }

  // Case 2: numeric only: "1", "2", ...
  m = /^(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    return {
      id: `station-${m[1]}`,
      color,
      label: color
        ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
        : `Station-${m[1]}`,
    };
  }

  // Case 3: colour name: "red", "blue", ...
  const colourIdx = COLOR_NAMES.indexOf(lower);
  if (colourIdx >= 0) {
    return {
      id: `station-${colourIdx + 1}`,
      color: lower,
      label: `Station-${lower[0].toUpperCase()}${lower.slice(1)}`,
    };
  }

  // Case 4: "station-red", "station-blue", ...
  m = /^station-(\w+)$/.exec(lower);
  if (m && COLOR_NAMES.includes(m[1])) {
    const colourIdx2 = COLOR_NAMES.indexOf(m[1]) + 1;
    return {
      id: `station-${colourIdx2}`,
      color: m[1],
      label: `Station-${m[1][0].toUpperCase()}${m[1].slice(1)}`,
    };
  }

  // Case 5: URL that contains a color segment like ".../red"
  const colorRegex = new RegExp(
    `(?:^|[\\/\\?#&=])(${COLOR_NAMES.join("|")})(?:$|[\\/\\?#&=])`,
    "i"
  );
  const cm = lower.match(colorRegex);
  if (cm) {
    const c = cm[1].toLowerCase();
    const idx = COLOR_NAMES.indexOf(c);
    return {
      id: `station-${idx + 1}`,
      color: c,
      label: `Station-${c[0].toUpperCase()}${c.slice(1)}`,
    };
  }

  // Default fallback
  return { id: s, color: null, label: s.toUpperCase() };
}

function titleCaseRoom(label) {
  const s = (label || "").toString().trim();
  if (!s) return "CLASSROOM";
  return s.toUpperCase();
}

function displayRoomFromSlugOrLabel(loc, selectedRooms) {
  // if teacher provided “Upper Hallway”, show that; otherwise fall back to slug-ish text
  const cleaned = (loc || "").toString().trim();
  if (!cleaned) return "CLASSROOM";

  const found =
    (selectedRooms || []).find((r) => r.toLowerCase() === cleaned.toLowerCase()) ||
    null;

  // if it’s already a nice label, use it; else make slug more readable
  const label = found || cleaned.replace(/[-_]/g, " ").replace(/\s+/g, " ");
  return titleCaseRoom(label);
}

function getStationBubbleStyles(colorName) {
  // Default pale yellow & dark text when no station colour yet
  if (!colorName) {
    return {
      background: "#fef9c3",
      color: "#111827",
    };
  }

  const COLOR_MAP = {
    red: "#ef4444",
    blue: "#3b82f6",
    green: "#22c55e",
    yellow: "#eab308",
    purple: "#a855f7",
    orange: "#f97316",
    teal: "#14b8a6",
    pink: "#ec4899",
  };

  const bg = COLOR_MAP[colorName] || "#fef9c3";

  // Light-ish colours → dark text; dark colours → white text
  const lightColours = ["yellow", "orange", "teal", "pink"];
  const isLight = lightColours.includes(colorName);

  return {
    background: bg,
    color: isLight ? "#111827" : "#ffffff",
  };
}

// ---------------------------------------------------------------------
// Shared socket instance – same host as backend
// ---------------------------------------------------------------------
const socket = io(API_BASE_URL, {
  withCredentials: true,
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// ---------------------------------------------------------------------
// Local session persistence (room + team session)
// - Refresh/reconnect should auto-resume the same room + team.
// - Only "Join another room" clears these keys.
// ---------------------------------------------------------------------
const LS_KEYS = {
  roomCode: "curriculate.roomCode",
  teamSessionId: "curriculate.teamSessionId",
  teamName: "curriculate.teamName",
  members: "curriculate.members",
};

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
function clearSavedJoin() {
  lsDel(LS_KEYS.roomCode);
  lsDel(LS_KEYS.teamSessionId);
  lsDel(LS_KEYS.teamName);
  lsDel(LS_KEYS.members);
}

// -----------------------------
// Objective answer-key helpers
// -----------------------------
const isObjectiveTask = (task) => {
  if (!task) return false;

  // explicit flags
  if (task.objectiveScoring === true) return true;
  if (task?.config?.objectiveScoring === true) return true;

  // common "no AI" marker in this project
  if (task.aiScoringRequired === false) return true;

  // heuristic: objective task types usually ship correct answers/config
  const t = task.taskType || task.type;
  const items = Array.isArray(task.items) ? task.items : [];
  const hasItemCorrect = items.some(
    (it) => it && (it.correctAnswer !== undefined || it.referenceAnswer)
  );
  const hasTopCorrect = task.correctAnswer !== undefined && task.correctAnswer !== null;
  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  const hasSortConfig =
    Array.isArray(cfg.buckets) &&
    cfg.buckets.length >= 2 &&
    Array.isArray(cfg.items) &&
    cfg.items.length >= 2 &&
    cfg.items.some((it) => typeof it?.bucketIndex === "number");
  const hasSeqConfig = Array.isArray(cfg.items) && cfg.items.length >= 2;

  const objectiveTypes = new Set([
    TASK_TYPES.TRUE_FALSE,
    TASK_TYPES.MULTIPLE_CHOICE,
    TASK_TYPES.SHORT_ANSWER,
    TASK_TYPES.SORT,
    TASK_TYPES.SEQUENCE,
    TASK_TYPES.TIMELINE,
  ]);

  if (objectiveTypes.has(t) && (hasItemCorrect || hasTopCorrect || hasSortConfig || hasSeqConfig))
    return true;

  // scoringMode string fallback
  if (task.scoringMode && String(task.scoringMode).toLowerCase().includes("objective"))
    return true;

  return false;
};

const getItemPrompt = (item, idx) => {
  const raw =
    item?.prompt ??
    item?.question ??
    item?.label ??
    item?.stem ??
    item?.text ??
    item?.title ??
    item?.description ??
    "";
  const s = typeof raw === "string" ? raw.trim() : String(raw || "").trim();
  return s || `Question ${idx + 1}`;
};

const tfCorrectToText = (val) => {
  // supports: boolean, "true"/"false", 0/1, "0"/"1"
  if (typeof val === "boolean") return val ? "True" : "False";
  if (typeof val === "number") return val === 0 ? "True" : "False";
  const s = String(val ?? "").trim().toLowerCase();
  if (s === "true") return "True";
  if (s === "false") return "False";
  if (s === "0") return "True";
  if (s === "1") return "False";
  return "";
};

const buildObjectiveAnswerKey = (task) => {
  if (!task) return null;

  const taskType = task.taskType || task.type;
  const items = Array.isArray(task.items) ? task.items : [];

  // --- TRUE/FALSE ---
  if (taskType === TASK_TYPES.TRUE_FALSE) {
    if (items.length) {
      return {
        title: "Answer key",
        rows: items.map((it, idx) => ({
          q: getItemPrompt(it, idx),
          a: tfCorrectToText(it?.correctAnswer) || "(missing correct answer)",
        })),
      };
    }
    // single TF fallback
    const single = tfCorrectToText(task.correctAnswer);
    if (single) {
      return {
        title: "Answer key",
        rows: [{ q: task.prompt || "True/False", a: single }],
      };
    }
  }

  // --- MULTIPLE CHOICE ---
  if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
    if (items.length) {
      return {
        title: "Answer key",
        rows: items.map((it, idx) => {
          const opts = Array.isArray(it.options) ? it.options : [];
          const c = it.correctAnswer;
          let correctText = "";
          if (typeof c === "number") correctText = opts[c] ?? "";
          else if (typeof c === "string") correctText = c;
          return { q: getItemPrompt(it, idx), a: String(correctText || "").trim() || "(missing correct answer)" };
        }),
      };
    }

    // single MC fallback
    const opts = Array.isArray(task.options) ? task.options : [];
    const c = task.correctAnswer;
    const correctText =
      typeof c === "number" ? opts[c] ?? "" : typeof c === "string" ? c : "";
    if (correctText) {
      return {
        title: "Answer key",
        rows: [{ q: task.prompt || "Multiple choice", a: String(correctText).trim() }],
      };
    }
  }

  // --- SHORT ANSWER ---
  if (taskType === TASK_TYPES.SHORT_ANSWER) {
    if (items.length) {
      return {
        title: "Suggested answers",
        rows: items.map((it, idx) => ({
          q: getItemPrompt(it, idx),
          a: String(it.referenceAnswer ?? it.answer ?? it.expected ?? "").trim() || "(no reference answer)",
        })),
      };
    }
    const ref = String(task.referenceAnswer ?? "").trim();
    if (ref) {
      return { title: "Suggested answer", rows: [{ q: task.prompt || "Short answer", a: ref }] };
    }
  }

  // --- SORT / CATEGORIZE ---
  if (taskType === TASK_TYPES.SORT) {
    const cfg = task.config && typeof task.config === "object" ? task.config : {};
    const buckets = Array.isArray(cfg.buckets) ? cfg.buckets : [];
    const sortItems = Array.isArray(cfg.items) ? cfg.items : [];

    if (buckets.length && sortItems.length) {
      const grouped = buckets.map((b) => ({ bucket: String(b || "").trim(), items: [] }));
      const unassigned = [];

      sortItems.forEach((it) => {
        const text = String(it?.text ?? it ?? "").trim();
        if (!text) return;
        const bi = it?.bucketIndex;
        if (typeof bi === "number" && bi >= 0 && bi < grouped.length) grouped[bi].items.push(text);
        else unassigned.push(text);
      });

      return {
        title: "Correct categories",
        buckets: grouped.filter((g) => g.bucket),
        unassigned,
      };
    }
  }

  // --- SEQUENCE / TIMELINE ---
  if (taskType === TASK_TYPES.SEQUENCE || taskType === TASK_TYPES.TIMELINE) {
    const cfg = task.config && typeof task.config === "object" ? task.config : {};
    const seq = Array.isArray(cfg.items) ? cfg.items : [];
    if (seq.length) {
      return {
        title: "Correct order",
        ordered: seq.map((it, idx) => ({
          n: idx + 1,
          text: String(it?.text ?? it ?? "").trim() || `Step ${idx + 1}`,
        })),
      };
    }
  }

  return null;
};

// ---------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------

function getThemeShell(uiTheme) {
  switch (uiTheme) {
    case "bold":
      return {
        pageBg: "radial-gradient(circle at top, #0f172a, #020617)",
        cardBg: "rgba(15,23,42,0.95)",
        cardBorder: "1px solid rgba(148,163,184,0.5)",
        text: "#e5e7eb",
      };
    case "minimal":
      return {
        pageBg: "#f3f4f6",
        cardBg: "#ffffff",
        cardBorder: "1px solid #e5e7eb",
        text: "#111827",
      };
    default: // "modern" / Theme 1
      return {
        pageBg: "linear-gradient(135deg, #0ea5e9, #6366f1)",
        cardBg: "#ffffff",
        cardBorder: "1px solid rgba(148,163,184,0.6)",
        text: "#0f172a",
      };
  }
}

function formatRemainingMs(ms) {
  if (!ms || ms <= 0) return "00:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Error boundary to prevent a blank-white-screen if a task component throws
// ---------------------------------------------------------------------
class TaskErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error) {
    if (this.props.onError) this.props.onError(error);
    // Also log for DevTools
    console.error("Task render error:", error);
  }
  render() {
    if (this.state.hasError) {
      const msg =
        (this.state.error && (this.state.error.message || String(this.state.error))) ||
        "Unknown error";
      return (
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>⚠ Task crashed</div>
          <div style={{ marginTop: 8, opacity: 0.85 }}>{msg}</div>
          {this.props.fallback || null}
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------

function StudentApp() {
  console.log("Curriculate StudentApp");

  // Theme selector (must be inside component)
  const [uiTheme, setUiTheme] = useState("modern"); // "modern" | "bold" | "minimal"
  const themeShell = getThemeShell(uiTheme);

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [leaderboard, setLeaderboard] = useState([]); // Update via socket.on('leaderboard-update', setLeaderboard)
  const [tasksetComplete, setTasksetComplete] = useState(false);
  const [postPhase, setPostPhase] = useState("tasks"); // "tasks" | "feedback" | "trophy"
  const [taskRenderError, setTaskRenderError] = useState(null);

  const [roomCode, setRoomCode] = useState(() => lsGet(LS_KEYS.roomCode) || "");
  const [teamName, setTeamName] = useState(() => lsGet(LS_KEYS.teamName) || "");
  const [members, setMembers] = useState(() => {
    try {
      const raw = lsGet(LS_KEYS.members);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : ["", "", ""];
    } catch {
      return ["", "", ""];
    }
  });
  const [roomIsActive, setRoomIsActive] = useState(false);
  const [roomState, setRoomState] = useState(null);

  // Collaboration
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [showPartnerReply, setShowPartnerReply] = useState(false);

  // Persistent identifiers
  const [teamId, setTeamId] = useState(null); // TeamSession _id from backend
  const [teamSessionId, setTeamSessionId] = useState(null);
  const userDroppedRoomRef = useRef(false);
  const resumeAttemptedRef = useRef(false);

  const lastStationIdRef = useRef(null);

  // Station + scanner state
  const [assignedStationId, setAssignedStationId] = useState(null);
  const [assignedColor, setAssignedColor] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanStatus, setScanStatus] = useState(null); // null | "ok" | "error"
  const [waitingForLaunch, setWaitingForLaunch] = useState(false);

  // Task + timer state
  const [currentTask, setCurrentTask] = useState(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(null);
  const [tasksetTotalTasks, setTasksetTotalTasks] = useState(null);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [currentAnswerDraft, setCurrentAnswerDraft] = useState("");

  // Noise + treats
  const [noiseState, setNoiseState] = useState({
    enabled: false,
    threshold: 0,
    level: 0,
    brightness: 1,
  });
  const [treatMessage, setTreatMessage] = useState(null);

  // 🔢 Scoring: running total + last-task result + toast
  const [scoreTotal, setScoreTotal] = useState(0);
  const [lastTaskResult, setLastTaskResult] = useState(null);
  const [pointToast, setPointToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  // Correct-answer reveal for SHORT_ANSWER tasks
  const [shortAnswerReveal, setShortAnswerReveal] = useState(null);

  // How long to keep task visible after submit for review
  const [reviewPauseSeconds, setReviewPauseSeconds] = useState(15);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const [taskLocked, setTaskLocked] = useState(false);
  const [reviewState, setReviewState] = useState(null);

  // Teacher-defined location (e.g. "Classroom", "Hallway") + stable ref
  const [roomLocation, setRoomLocation] = useState(DEFAULT_LOCATION);
  const roomLocationFromStateRef = useRef(DEFAULT_LOCATION);

  // Audio
  const [audioContext, setAudioContext] = useState(null);
  const sndAlert = useRef(null);
  const sndTreat = useRef(null);

  // Timer refs
  const countdownTimerRef = useRef(null);
  const postSubmitTimerRef = useRef(null);

  // ─────────────────────────────────────────────
  // Socket connect / disconnect + auto-resume
  // ─────────────────────────────────────────────

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setStatusMessage("");
    };

    const handleDisconnect = () => {
      setConnected(false);
      setStatusMessage("Disconnected from server. Trying to reconnect…");
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setStatusMessage("Error connecting. Retrying…");
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error");
    };
  }, []);

  // ─────────────────────────────────────────────
  // Auto-resume: after refresh/reconnect, re-join the same room + team
  // (unless the user explicitly chose "Join another room")
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    if (joined) return;
    if (userDroppedRoomRef.current) return;
    if (resumeAttemptedRef.current) return;

    const savedRoom = (lsGet(LS_KEYS.roomCode) || "").trim().toUpperCase();
    const savedTeamSessionId = (lsGet(LS_KEYS.teamSessionId) || "").trim();

    if (!savedRoom || !savedTeamSessionId) return;

    resumeAttemptedRef.current = true;
    setStatusMessage("Reconnecting to your room…");

    socket.emit(
      "resume-team-session",
      { roomCode: savedRoom, teamSessionId: savedTeamSessionId },
      (resp) => {
        const ok = resp && (resp.success === true || resp.ok === true);
        if (!ok) {
          // If resume fails, clear saved keys so the join form works normally.
          clearSavedJoin();
          setStatusMessage(resp?.error || "Could not resume your session. Please join again.");
          return;
        }

        setRoomCode(savedRoom);
        setTeamId(resp.teamId || savedTeamSessionId);
        setTeamSessionId(resp.teamId || savedTeamSessionId);
        setJoined(true);
        setStatusMessage("");

        // Restore station + colour
        const stationId = resp.assignedStationId || resp.stationId || null;
        if (stationId) {
          const stationInfo = normalizeStationId(stationId);
          setAssignedStationId(stationInfo.id);
          setAssignedColor(stationInfo.color || null);
          lastStationIdRef.current = stationInfo.id;
        }

        // Restore room state bits (scores/noise/location)
        const state = resp.roomState || null;
        if (state?.scores && typeof state.scores[(resp.teamId || savedTeamSessionId)] === "number") {
          setScoreTotal(state.scores[(resp.teamId || savedTeamSessionId)]);
        }
        const expectedRoom = displayRoomFromSlugOrLabel(
          roomState?.teams?.[teamId]?.locationSlug || "Classroom",
          roomState?.selectedRooms || []
        );
        const expectedColor = (assignedColor || "").toUpperCase();

        // If a taskset is running, backend will send the current task immediately.
        // Make sure scanner is off until we need it.
        if (!mustScan) setScannerActive(false);
      }
    );
  }, [connected, joined]);

  // ─────────────────────────────────────────────
  // Server event listeners – room, tasks, noise, treats, scoring
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!teamId) return;

    // Room / station state updates
    const handleRoomState = (state) => {
      if (!state || !teamId) return;
      const myTeam = state.teams?.[teamId];
      if (!myTeam) return;

      // 🔢 Update running total score from room-wide scores map
      if (state.scores && typeof state.scores[teamId] === "number") {
        setScoreTotal(state.scores[teamId]);
      }

      // 🏆 Build a simple leaderboard from room state (fallback if no leaderboard-update event)
      if (state.scores && state.teams) {
        const entries = Object.entries(state.scores)
          .filter(([, sc]) => typeof sc === "number")
          .map(([tid, sc]) => ({
            teamName:
              state.teams?.[tid]?.teamName ||
              state.teams?.[tid]?.name ||
              `Team-${String(tid).slice(-4)}`,
            score: sc,
            rankChange: 0,
          }))
          .sort((a, b) => b.score - a.score);
        setLeaderboard(entries);
      }

      // ✅ store full roomState (instead of setSelectedRooms which doesn't exist)
      setRoomState(state);

      const newStationId = myTeam.currentStationId || myTeam.stationId;
      if (newStationId && newStationId !== lastStationIdRef.current) {
        lastStationIdRef.current = newStationId;
        const stationInfo = normalizeStationId(newStationId);
        setAssignedStationId(stationInfo.id);
        setAssignedColor(stationInfo.color || null);
      }

      const loc =
        myTeam.locationSlug ||
        state.locationSlug ||
        roomLocationFromStateRef.current ||
        DEFAULT_LOCATION;
      setRoomLocation(loc);
      roomLocationFromStateRef.current = loc;

      setRoomIsActive(!!state.isActive);

      const noiseCfg = state.noiseConfig || {};
      setNoiseState((prev) => ({
        ...prev,
        enabled: !!noiseCfg.enabled,
        threshold: typeof noiseCfg.threshold === "number" ? noiseCfg.threshold : 0,
      }));
    };

    const handleTaskAssigned = (payload) => {
      if (!payload) return;
      setCurrentTask(payload.task || payload || null);
      const idx =
        typeof payload.taskIndex === "number"
          ? payload.taskIndex
          : typeof payload.index === "number"
          ? payload.index
          : null;
      setCurrentTaskIndex(idx);
      const total =
        typeof payload.totalTasks === "number"
          ? payload.totalTasks
          : typeof payload.total === "number"
          ? payload.total
          : null;
      setTasksetTotalTasks(total);

      const limit = payload.timeLimitSeconds || null;
      setTimeLimitSeconds(limit);

      console.log("[StudentApp] task:assigned", payload?.task || payload);

      if (limit && limit > 0) {
        const endTime = Date.now() + limit * 1000;
        setRemainingMs(endTime - Date.now());
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
        }
        countdownTimerRef.current = setInterval(() => {
          setRemainingMs((prev) => {
            if (!prev || prev <= 1000) {
              clearInterval(countdownTimerRef.current);
              return 0;
            }
            return prev - 1000;
          });
        }, 1000);
      } else {
        setRemainingMs(0);
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
      }

      setCurrentAnswerDraft("");
      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);
      setLastTaskResult(null);
      setPointToast(null);
      setShortAnswerReveal(null);
      setTasksetComplete(false);
      setPostPhase("tasks");
      setTaskRenderError(null);

      // ✅ Clear waiting overlay when a task arrives
      setWaitingForLaunch(false);
    };

    // AI scoring + feedback
    const handleTaskScored = (payload) => {
      if (!payload || typeof payload !== "object") return;

      const {
        teamId: scoredTeamId,
        taskId,
        taskIndex,
        scoreDelta,
        totalScore,
        maxPoints,
        aiFeedback,
        correctAnswer,
        shortAnswerReveal: reveal,
        method,
      } = payload;

      if (!teamId || scoredTeamId !== teamId) return;

      if (typeof totalScore === "number") {
        setScoreTotal(totalScore);
      } else if (typeof scoreDelta === "number") {
        setScoreTotal((prev) => prev + scoreDelta);
      }

      setLastTaskResult({
        scoreDelta: typeof scoreDelta === "number" ? scoreDelta : null,
        maxPoints: typeof maxPoints === "number" ? maxPoints : null,
        aiFeedback: aiFeedback || null,
        taskId: taskId || null,
        taskIndex: typeof taskIndex === "number" && taskIndex >= 0 ? taskIndex : null,
        method: method || null,
        correctAnswer: correctAnswer ?? null,
      });

      const lockSeconds =
        Number(payload?.postSubmitSeconds) > 0
          ? Number(payload.postSubmitSeconds)
          : DEFAULT_POST_SUBMIT_SECONDS;

      setTaskLocked(true);
      setPostSubmitSecondsLeft(lockSeconds);
      if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);
      let t = lockSeconds;
      const timer = setInterval(() => {
        t -= 1;
        setPostSubmitSecondsLeft(t);

        if (t <= 0) {
          clearInterval(timer);
          endReviewAndReturnToScan();
        }
      }, 1000);

      postSubmitTimerRef.current = timer;

      if (reveal) {
        setShortAnswerReveal(reveal);
      }

      if (typeof scoreDelta === "number") {
        setPointToast({
          message:
            scoreDelta > 0
              ? `+${scoreDelta} point${scoreDelta === 1 ? "" : "s"}`
              : scoreDelta < 0
              ? `${scoreDelta} points`
              : "No points this time",
          positive: scoreDelta > 0,
        });

        if (scoreDelta > 0 && maxPoints && scoreDelta >= maxPoints) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 2200);
        }

        setTimeout(() => {
          setPointToast(null);
        }, 2500);
      }
    };

    const handleNoiseUpdate = (payload) => {
      if (!payload) return;
      setNoiseState((prev) => ({
        ...prev,
        level: typeof payload.level === "number" ? payload.level : prev.level,
        brightness: typeof payload.brightness === "number" ? payload.brightness : prev.brightness,
      }));
    };

    const handleTreat = (payload) => {
      if (!payload) return;
      if (payload.type === "point-bonus") {
        setTreatMessage(payload.message || "Surprise point bonus for your team!");
        tryPlayTreatSound();
        setTimeout(() => setTreatMessage(null), 4000);
      } else if (payload.type === "fun-message") {
        setTreatMessage(payload.message || "Random treat for being awesome!");
        tryPlayTreatSound();
        setTimeout(() => setTreatMessage(null), 4000);
      }
    };

    const handleCollabPartner = (payload) => {
      if (!payload || payload.teamId !== teamId) return;
      setPartnerAnswer(payload.answer ?? null);
    };

    const handleCollabReply = (payload) => {
      if (!payload || payload.teamId !== teamId) return;
      setShowPartnerReply(true);
      setTimeout(() => setShowPartnerReply(false), 4000);
    };

    socket.on("room:state", handleRoomState);
    socket.on("task:assigned", handleTaskAssigned);
    socket.on("task:launch", handleTaskAssigned);
    socket.on("new-task", (payload) =>
      handleTaskAssigned({
        task: payload?.task || payload,
        index: payload?.taskIndex ?? payload?.index ?? 0,
        taskIndex: payload?.taskIndex ?? payload?.index ?? 0,
        totalTasks: payload?.totalTasks,
        timeLimitSeconds: payload?.timeLimitSeconds,
      })
    );
    socket.on("task:scored", handleTaskScored);
    socket.on("task:advance", handleTaskAssigned);
    socket.on("noise:update", handleNoiseUpdate);
    socket.on("treat:event", handleTreat);
    socket.on("collab:partner-answer", handleCollabPartner);
    socket.on("collab:reply", handleCollabReply);

    socket.emit("room:request-state", { teamId });

    return () => {
      socket.off("room:state", handleRoomState);
      socket.off("task:assigned", handleTaskAssigned);
      socket.off("task:launch", handleTaskAssigned);
      socket.off("new-task");
      socket.off("task:scored", handleTaskScored);
      socket.off("task:advance", handleTaskAssigned);
      socket.off("noise:update", handleNoiseUpdate);
      socket.off("treat:event", handleTreat);
      socket.off("collab:partner-answer", handleCollabPartner);
      socket.off("collab:reply", handleCollabReply);
    };
  }, [teamId, reviewPauseSeconds]);

  // -------------------------------------------------------------------
  // Auto-open scanner when a scan is required
  // -------------------------------------------------------------------
  const enforceLocation = !!roomState?.taskset?.enforceLocation;
  const selectedRooms = roomState?.selectedRooms || [];

  const taskHardLocksStation =
    !!enforceLocation ||
    !!currentTask?.lockToStation ||
    !!currentTask?.config?.lockToStation ||
    !!currentTask?.fixedStationId ||
    !!currentTask?.config?.fixedStationId ||
    !!currentTask?.lockToStationId ||
    !!currentTask?.config?.lockToStationId;
    
  const mustScan =
  assignedStationId
    ? (scannedStationId !== assignedStationId)
    : (!!assignedColor && !scannedStationId);

  const hardMustScan = taskHardLocksStation && mustScan;
    
  const lastRequestNextAtRef = useRef(0);

  useEffect(() => {
    if (!joined) return;

    // If we’re supposed to scan (because of gating), open camera.
    if (mustScan && !scannerActive) {
      setScannerActive(true);
      return;
    }

    // Ensure assignment info is fetched so colour can display
    const inferredColor = assignedColor || normalizeStationId(assignedStationId)?.color;
    if (!inferredColor && teamId) socket.emit("room:request-state", { teamId });
      }, [
        joined,
        mustScan,
        currentTask,
        waitingForLaunch,
        assignedColor,
        assignedStationId,
        teamId,
      ]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
      }
    };
  }, []);

  // ─────────────────────────────────────────────
  // Audio setup (alert + treat sounds)
  // ─────────────────────────────────────────────
  useEffect(() => {
    try {
      const alertAudio = new Audio("https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg");
      alertAudio.volume = 0.15;
      sndAlert.current = alertAudio;

      const treatAudio = new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg");
      treatAudio.volume = 0.2;
      sndTreat.current = treatAudio;
    } catch (err) {
      console.warn("Could not preload audio:", err);
    }
  }, []);

  function tryPlayAlertSound() {
    try {
      sndAlert.current && sndAlert.current.play();
    } catch (err) {
      console.warn("Alert sound play blocked:", err);
    }
  }

  function tryPlayTreatSound() {
    try {
      sndTreat.current && sndTreat.current.play();
    } catch (err) {
      console.warn("Treat sound play blocked:", err);
    }
  }

  // ─────────────────────────────────────────────
  // Join room + submit handlers
  // ─────────────────────────────────────────────

  const canJoin =
    roomCode.trim().length >= 2 &&
    teamName.trim().length >= 1 &&
    members.some((m) => m.trim().length > 0);

  const handleJoinRoom = () => {
    const payload = {
      roomCode: roomCode.trim().toUpperCase(),
      teamName: (teamName || "").trim(),
      members: Array.isArray(members) ? members : [],
      locationSlug: roomLocation || DEFAULT_LOCATION,
    };

    setJoiningRoom(true);
    setStatusMessage("");

    socket.emit("student:join-room", payload, (response) => {
      setJoiningRoom(false);

      const ok = response && (response.ok === true || response.success === true);
      if (!ok) {
        setStatusMessage(response?.error || "Could not join. Check the code with your teacher.");
        return;
      }

      // core join state
      setJoined(true);
      setStatusMessage("");

      // Gold-standard pipeline start: Join → Scan → Mood → Treasure → first task
      setPostPhase("scan");
      setTasksetComplete(false);
      setTaskRenderError(null);

      // scan/task flags
      setScannedStationId(null);
      setScanStatus(null);
      setScanError(null);
      setScannerActive(false); // enable after we confirm assignment
      setWaitingForLaunch(false);

      const tid = response.teamId || response.teamSessionId;
      setTeamId(tid);
      setTeamSessionId(response.teamSessionId || response.teamId || null);

      // ✅ Persist this join so refresh/reconnect can auto-resume.
      lsSet(LS_KEYS.roomCode, payload.roomCode);
      lsSet(LS_KEYS.teamSessionId, String(tid));
      lsSet(LS_KEYS.teamName, payload.teamName);
      try {
        lsSet(LS_KEYS.members, JSON.stringify(payload.members || []));
      } catch {}
      userDroppedRoomRef.current = false;
      resumeAttemptedRef.current = false;

      // -------------------------
      // Station assignment (color + stationId)
      // -------------------------
      const joinStationId = response?.stationId || response?.assignedStationId;
      if (joinStationId) {
        const stationInfo = normalizeStationId(joinStationId);
        setAssignedStationId(stationInfo.id);
        setAssignedColor(stationInfo.color || response?.assignedColor || null);
        lastStationIdRef.current = stationInfo.id;
      } else if (response?.assignedColor) {
        setAssignedColor(String(response.assignedColor).toLowerCase());
      }

      // location
      const locSlug =
        response.locationSlug || roomLocationFromStateRef.current || DEFAULT_LOCATION;
      setRoomLocation(locSlug);
      roomLocationFromStateRef.current = locSlug;

      // noise config
      const noiseCfg = response.noiseConfig || {};
      setNoiseState((prev) => ({
        ...prev,
        enabled: !!noiseCfg.enabled,
        threshold: typeof noiseCfg.threshold === "number" ? noiseCfg.threshold : 0,
      }));

      // -------------------------
      // Current task on join
      // We do NOT jump into real tasks; warm-up pipeline owns the start.
      // If backend sends MoodCheck-in as currentTask, allow it; otherwise ignore until Treasure requests.
      // -------------------------
      if (response.currentTask?.task) {
        const ct = response.currentTask.task;
        const t = String(ct?.taskType || ct?.type || "").toLowerCase();
        if (t === "mood-checkin") {
          setCurrentTask(ct);
          setCurrentTaskIndex(
            typeof response.currentTask.taskIndex === "number"
              ? response.currentTask.taskIndex
              : null
          );
          setTasksetTotalTasks(
            typeof response.currentTask.totalTasks === "number"
              ? response.currentTask.totalTasks
              : null
          );

          const limit = response.currentTask.timeLimitSeconds || null;
          setTimeLimitSeconds(limit);

          if (limit && limit > 0) {
            const endTime = Date.now() + limit * 1000;
            setRemainingMs(endTime - Date.now());
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = setInterval(() => {
              setRemainingMs((prev) => {
                if (!prev || prev <= 1000) {
                  clearInterval(countdownTimerRef.current);
                  return 0;
                }
                return prev - 1000;
              });
            }, 1000);
          } else {
            setRemainingMs(0);
          }
        } else {
          setCurrentTask(null);
          setCurrentTaskIndex(null);
          setTasksetTotalTasks(null);
          setTimeLimitSeconds(null);
          setRemainingMs(0);
        }
      } else {
        setCurrentTask(null);
        setCurrentTaskIndex(null);
        setTasksetTotalTasks(null);
        setTimeLimitSeconds(null);
        setRemainingMs(0);
      }

      // -------------------------
      // Turn on camera scanner if we have any assignment signal
      // -------------------------
      setTimeout(() => {
        const hasAssignment = !!(
          response?.stationId ||
          response?.assignedStationId ||
          response?.assignedColor
        );
        if (hasAssignment) setScannerActive(true);
      }, 0);
    });
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!canJoin || joiningRoom) return;
    handleJoinRoom();
  };

  // Explicit user action: drop current room and show the join form.
    // This is the ONLY time we clear saved join keys.
    const handleJoinAnotherRoom = () => {
      userDroppedRoomRef.current = true;
      resumeAttemptedRef.current = false;
      clearSavedJoin();

      // reset core session state
      setJoined(false);
      setTeamId(null);
      setTeamSessionId(null);
      setStatusMessage("");

      // reset station/task/scanner state
      setAssignedStationId(null);
      setAssignedColor(null);
      setScannedStationId(null);
      setScannerActive(false);
      setScanError(null);
      setScanStatus(null);
      setWaitingForLaunch(false);

      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setTasksetTotalTasks(null);
      setTimeLimitSeconds(null);
      setRemainingMs(0);
      setSubmitting(false);
      setCurrentAnswerDraft("");

      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);
      setLastTaskResult(null);
      setPointToast(null);
      setShortAnswerReveal(null);
      setTasksetComplete(false);
      setTaskRenderError(null);

      // reset pipeline
      setPostPhase("join");

      // clear join form fields (optional, but expected UX)
      setRoomCode("");
      setTeamName("");
      setMembers(["", "", ""]);
    };

    // ----------------------------------------------------
    // End the 15s review lock and return to scan state
    // (Used by BOTH the server-scored path and the fallback timer)
    // ----------------------------------------------------
    const endReviewAndReturnToScan = () => {
      // stop lock + countdown
      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);

      const isLastTask =
        typeof currentTaskIndex === "number" &&
        typeof tasksetTotalTasks === "number" &&
        currentTaskIndex >= 0 &&
        tasksetTotalTasks > 0 &&
        currentTaskIndex === tasksetTotalTasks - 1;

      // If this was the last task in the taskset, go to post-task feedback first
      if (isLastTask) {
        setPostPhase("feedback");
        setTasksetComplete(false);
        setScannerActive(false);
        setReviewState(null);

        // Refresh room state one last time so scores/leaderboard are up to date
        socket.emit("room:request-state", { teamId });

        // hide task UI
        setCurrentTask(null);
        setCurrentTaskIndex(null);
        setShortAnswerReveal(null);
        return;
      }

      // hide task UI so scanner is visible
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setShortAnswerReveal(null);

      // reset scan gate/error state (return to scan)
      setScannedStationId(null);
      setScanStatus(null);
      setScanError(null);

      setPostPhase("scan");

      // refresh assignment + show scanner
      socket.emit("room:request-state", { teamId });
      setScannerActive(true);

      setReviewState(null);
    };

    const handleSubmitAnswer = (answerPayload) => {
      if (!roomCode || !joined || submitting || taskLocked) return;

      // Determine payload type (warm-up tasks may submit without currentTask)
      const payloadType =
        (answerPayload && typeof answerPayload === "object" &&
          (answerPayload.type || answerPayload.taskType)) ||
        null;

      // Mood = advance pipeline only
      if (payloadType === TASK_TYPES.MOOD_CHECKIN) {
        setSubmitting(false);
        setStatusMessage("");
        setPostPhase("treasure");
        return;
      }

      // Treasure = score only, stay in treasure until task arrives
      if (!currentTask && payloadType === TASK_TYPES.TREASURE_RUNNER) {
        // scoring logic (you already have this)
        setSubmitting(false);
        return;
      }

      // ----------------------------------------------------
      // Treasure Runner: allow submits even without currentTask
      // ----------------------------------------------------
      const isTreasure =
        payloadType === TASK_TYPES.TREASURE_RUNNER ||
        payloadType === "treasure-runner";

      if (!currentTask && isTreasure) {
        setSubmitting(true);

        const deltaRaw =
          answerPayload?.pointsEarned ??
          answerPayload?.points ??
          answerPayload?.scoreDelta ??
          0;

        const delta = Number(deltaRaw) || 0;
        if (delta) setScoreTotal((prev) => (typeof prev === "number" ? prev + delta : delta));

        try {
          socket.emit("score:add", {
            roomCode: roomCode.trim().toUpperCase(),
            teamId,
            delta,
            reason: "TreasureRunner",
            meta: answerPayload || null,
          });
          socket.emit("treasure:finish", {
            roomCode: roomCode.trim().toUpperCase(),
            teamId,
            ...answerPayload,
            delta,
          });
        } catch {}

        setSubmitting(false);
        return;
      }

      // ----------------------------------------------------
      // Mood Check-in: DO NOT requestNext here.
      // Flow rule: Scan → Mood → Treasure (idle) → first task arrives → tasks
      // ----------------------------------------------------
      const isMood =
        payloadType === TASK_TYPES.MOOD_CHECKIN ||
        payloadType === "mood-checkin"; // optional backward compatibility

      if (isMood) {
        setSubmitting(false);
        setStatusMessage("");
        setPostPhase("treasure");
        return;
      }

      // If there’s no currentTask and it’s not a warm-up payload, do nothing.
      if (!currentTask) return;

      setSubmitting(true);

      // Normalize multi-part payloads from TaskRunner (can be object or JSON string)
      let normalizedAnswer = answerPayload;
      if (typeof answerPayload === "string" && answerPayload.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(answerPayload);
          if (parsed && typeof parsed === "object") normalizedAnswer = parsed;
        } catch {
          // leave as string
        }
      }

      const payload = {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        taskId: currentTask._id || currentTask.id,
        taskIndex:
          typeof currentTaskIndex === "number" && currentTaskIndex >= 0
            ? currentTaskIndex
            : null,
        answer: normalizedAnswer,
      };

      socket.emit("task:submit", payload, (response) => {
        setSubmitting(false);

        if (!response || response.error) {
          console.warn("Submit error:", response?.error || "Unknown error");
          setStatusMessage(response?.error || "There was a problem submitting. Try again.");
          return;
        }

        setStatusMessage("");
        setTaskLocked(true);

        // Always start a review countdown so the task will clear even if task:scored never arrives
        const fallbackSeconds =
          Number(response?.postSubmitSeconds) > 0
            ? Number(response.postSubmitSeconds)
            : DEFAULT_POST_SUBMIT_SECONDS;

        setReviewState({
          ...(response?.review && typeof response.review === "object" ? response.review : null),
          correct: typeof response?.correct === "boolean" ? response.correct : undefined,
          points: typeof response?.points === "number" ? response.points : undefined,

          studentAnswer: normalizedAnswer,
          taskId: payload.taskId,
          taskIndex: payload.taskIndex,
          secondsLeft: fallbackSeconds,
        });

        setPostSubmitSecondsLeft(fallbackSeconds);

        if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);

        let t = fallbackSeconds;
        const timer = setInterval(() => {
          t -= 1;
          setPostSubmitSecondsLeft(t);
          if (t <= 0) {
            clearInterval(timer);
            endReviewAndReturnToScan();
          }
        }, 1000);

        postSubmitTimerRef.current = timer;

        if (response.alertSound) {
          tryPlayAlertSound();
        }
      });
    };

  // ─────────────────────────────────────────────
  // QR Scanner
  // ─────────────────────────────────────────────

  const handleScan = (data) => {
    if (!data || !joined || !teamId) return;

    setScanError(null);

    const norm = normalizeStationId(data);
    if (!norm?.id) {
      setScanError("Unrecognized station QR code.");
      return;
    }

    const code = (roomCode || "").trim().toUpperCase();

    // Avoid TDZ: do NOT reference isMultiRoom here (it's declared later)
    const multi = Array.isArray(selectedRooms) && selectedRooms.length > 1;

    const scanPayload = {
      roomCode: code,
      teamId,
      stationId: norm.id,
    };

    // Only include locationSlug when it should be enforced (multi-room hunts)
    if (enforceLocation && multi) {
      scanPayload.locationSlug = (roomLocation || "").trim().toLowerCase().replace(/\s+/g, "-");
    }

    socket.emit("station:scan", scanPayload, (resp) => {
      if (!resp || resp.ok === false) {
        setScanStatus("error");
        setWaitingForLaunch(false);
        setScannedStationId(null);
        setScanError(resp?.error || "Scan not accepted.");
        setScannerActive(true);
        return;
      }

      setScanError(null);

      // ✅ define expectedId locally (was missing)
      const expectedId = resp?.stationId
        ? normalizeStationId(resp.stationId).id
        : assignedStationId;

      const accepted = norm.id === expectedId;

      if (!accepted) {
        setScanStatus("error");
        setWaitingForLaunch(false);
        setScannedStationId(null);
        setScanError("Wrong station. Scan your assigned station QR.");
        setScannerActive(true);
        return;
      }

      setScanStatus("ok");
      setScanError(null);
      setScannedStationId(norm.id);
      setScannerActive(false);

      const isInitial = !!resp?.initialAssignment;
      const waiting = !!resp?.waitingForLaunch || !roomIsActive;

      // After a correct scan, we ALWAYS go into the warm-up pipeline.
      // No task requests from scan.
      setWaitingForLaunch(true);
      setPostPhase("mood");

    });
  };

  useEffect(() => {
    if (!joined) return;
    if (postPhase !== "treasure") return;
    if (!roomIsActive) return;
    if (currentTask) return;
    if (!teamId || !roomCode) return;

    const now = Date.now();
    if (now - lastRequestNextAtRef.current < 1200) return;
    lastRequestNextAtRef.current = now;

    socket.emit("task:requestNext", {
      roomCode: roomCode.trim().toUpperCase(),
      teamId,
    });
  }, [joined, postPhase, roomIsActive, currentTask, teamId, roomCode]);

  // ─────────────────────────────────────────────
  // Derived values for UI
  // ─────────────────────────────────────────────
  const stationInfo = normalizeStationId(assignedStationId);
  const stationIndex = (() => {
    const m = /^station-(\d+)$/.exec(String(stationInfo?.id || ""));
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(0, Math.min(7, n - 1)); // clamp 0..7
  })();

  // ✅ Recreate the destination text after stationInfo exists
  const expectedLoc =
    roomState?.teams?.[teamId]?.locationSlug ||
    roomState?.teams?.[teamId]?.locationCode ||
    roomState?.locationCode ||
    "Classroom";

  const expectedRoom = displayRoomFromSlugOrLabel(expectedLoc, selectedRooms);
  const expectedColor = (assignedColor || stationInfo?.color || "").toUpperCase();

  const destinationText =
    enforceLocation && Array.isArray(selectedRooms) && selectedRooms.length > 1
      ? `${expectedRoom} ${expectedColor}`
      : `${expectedColor}`;

  const themedTask = currentTask
    ? {
        ...currentTask,
        locationSlug: normalizeLocationSlug(roomLocation),
        stationId: stationInfo?.id || null,
        stationColor: stationInfo?.color || assignedColor || null,
        stationIndex, // <-- Hangman uses this to select wordsByStation[stationIndex]
      }
    : null;

  const yourTeamName = teamName || "";
  const recentlyScoredBig = false; // or compute from lastTaskResult/pointToast if you already track it

  const isMultiRoom = Array.isArray(selectedRooms) && selectedRooms.length > 1;

  const noiseBarOpacity = noiseState.enabled ? noiseState.brightness : 0.08;

  const timerDisplay = timeLimitSeconds ? formatRemainingMs(remainingMs) : null;

  const responseFontSize = currentTask && currentTask.largeText ? "1.1rem" : "1rem";
  const responseHeadingFontSize = currentTask && currentTask.largeText ? "1.4rem" : "1.2rem";

  const isMotionMission = currentTask?.taskType === TASK_TYPES.MOTION_MISSION;
  const isPetFeeding = currentTask?.taskType === TASK_TYPES.PET_FEEDING;
  const isRecordAudio = currentTask?.taskType === TASK_TYPES.RECORD_AUDIO;

  const isJeopardy = currentTask?.taskType === TASK_TYPES.BRAINSTORM_BATTLE;
  const isFlashcardsRace = currentTask?.taskType === TASK_TYPES.FLASHCARDS_RACE;
  const isMadDash =
    currentTask?.taskType === TASK_TYPES.MAD_DASH ||
    currentTask?.taskType === TASK_TYPES.MAD_DASH_SEQUENCE;

  const isMakeAndSnap = currentTask?.taskType === TASK_TYPES.MAKE_AND_SNAP;

  const isMindMapper = currentTask?.taskType === TASK_TYPES.MIND_MAPPER;

  const isHangman =
    currentTask?.taskType === TASK_TYPES.HANGMAN_DUEL || currentTask?.taskType === "hangman-duel";

  const isMultipleChoice = currentTask?.taskType === TASK_TYPES.MULTIPLE_CHOICE;

  const isMusicalChairs = currentTask?.taskType === TASK_TYPES.MUSICAL_CHAIRS;

  const musicalChairsHeaderStyle = isMusicalChairs
    ? {
        animation: "mc-header-pulse 1.4s ease-in-out infinite",
      }
    : {};

  const isMysteryClues = currentTask?.taskType === TASK_TYPES.MYSTERY_CLUES;

  const mysteryHeaderStyle = isMysteryClues
    ? {
        animation: "mystery-glow 1.6s ease-in-out infinite",
      }
    : {};

  const hangmanHeaderStyle = isHangman
    ? {
        animation: "hangman-pulse 1.25s ease-in-out infinite",
      }
    : {};

  const isPhotoJournal =
    currentTask?.taskType === TASK_TYPES.PHOTO_JOURNAL ||
    currentTask?.taskType === "photo-journal" ||
    currentTask?.taskType === "photo_journal";

  const isDrawMime = currentTask?.taskType === TASK_TYPES.DRAW_MIME;
  const isLiveDebate = currentTask?.taskType === TASK_TYPES.LIVE_DEBATE;

  const isOpenText = currentTask?.taskType === TASK_TYPES.OPEN_TEXT;
  const isPhoto = currentTask?.taskType === TASK_TYPES.PHOTO;
  const isBrainSparkNotes = currentTask?.taskType === TASK_TYPES.BRAIN_SPARK_NOTES;

  const baseTaskCardStyle = {
    marginBottom: 12,
    padding: 14,
    borderRadius: 20,
    boxShadow: "0 10px 25px rgba(15,23,42,0.18)",
    border: "1px solid rgba(129,140,248,0.35)",
  };

  const taskCardBackground = isFlashcardsRace
    ? "linear-gradient(135deg, #0f172a 0%, #1d4ed8 35%, #a855f7 70%, #f97316 100%)"
    : isMadDash
    ? "linear-gradient(135deg, #b91c1c 0%, #f97316 40%, #facc15 80%)"
    : isMakeAndSnap
    ? "linear-gradient(135deg, #14b8a6 0%, #38bdf8 40%, #e0f2fe 100%)"
    : isMultipleChoice
    ? "linear-gradient(135deg, #22c55e 0%, #0ea5e9 40%, #eef2ff 100%)"
    : isDrawMime
    ? "linear-gradient(135deg, #fef3c7 0%, #fee2e2 40%, #f9fafb 100%)"
    : isLiveDebate
    ? "linear-gradient(135deg, #0f172a 0%, #fb7185 35%, #f97316 70%, #facc15 100%)"
    : isMindMapper
    ? "linear-gradient(135deg, #0f172a 0%, #22c55e 35%, #06b6d4 70%, #e0f2fe 100%)"
    : isMusicalChairs
    ? "linear-gradient(135deg, #f97316 0%, #ec4899 35%, #8b5cf6 70%, #fef3c7 100%)"
    : isMysteryClues
    ? "linear-gradient(135deg, #020617 0%, #1e293b 30%, #4f46e5 65%, #22c55e 100%)"
    : isOpenText
    ? "linear-gradient(135deg, #e0f2fe 0%, #f5f3ff 40%, #f9fafb 100%)"
    : isPhoto
    ? "linear-gradient(135deg, #0f172a 0%, #38bdf8 40%, #e0f2fe 100%)"
    : isPhotoJournal
    ? "linear-gradient(135deg, #0f172a 0%, #1d4ed8 35%, #a855f7 70%, #f97316 100%)"
    : isHangman
    ? "linear-gradient(135deg, #0f172a 0%, #22c55e 35%, #facc15 70%, #f97316 100%)"
    : isBrainSparkNotes
    ? "linear-gradient(135deg, #fef9c3 0%, #fee2e2 40%, #f9fafb 100%)"
    : "linear-gradient(135deg, #eef2ff 0%, #eff6ff 40%, #f9fafb 100%)";

  // Taskset progress
  const currentTaskNumber =
    typeof currentTaskIndex === "number" && currentTaskIndex >= 0 ? currentTaskIndex + 1 : null;

  const totalTasks =
    typeof tasksetTotalTasks === "number" && tasksetTotalTasks > 0 ? tasksetTotalTasks : null;

  const progressLabel =
    currentTaskNumber && totalTasks
      ? `Task ${currentTaskNumber} of ${totalTasks}`
      : currentTaskNumber
      ? `Task ${currentTaskNumber}`
      : null;

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: isFlashcardsRace
          ? "radial-gradient(circle at top, #1e293b 0%, #0f172a 25%, #4f46e5 60%, #f97316 100%)"
          : isMadDash
          ? "radial-gradient(circle at top, #b91c1c 0%, #f97316 40%, #facc15 75%, #fee2e2 100%)"
          : isMindMapper
          ? "radial-gradient(circle at top, #0f172a 0%, #0ea5e9 40%, #22c55e 75%, #e0f2fe 100%)"
          : themeShell.pageBg,
        color: themeShell.text,
        transition: "background 0.35s ease, color 0.25s ease",
      }}
    >
      <style>
        {`
        * {
          box-sizing: border-box;
        }

        .station-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          border: 1px solid rgba(15,23,42,0.25);
          background: rgba(255,255,255,0.85);
        }

        .station-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #e5e7eb;
        }

        .score-pill {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #fefce8;
          background: linear-gradient(135deg, #16a34a, #22c55e);
          box-shadow: 0 8px 18px rgba(22,163,74,0.35);
        }

        .score-pill span {
          margin-left: 4px;
        }

        .toast {
          position: fixed;
          left: 50%;
          bottom: 20px;
          transform: translateX(-50%);
          padding: 10px 16px;
          border-radius: 999px;
          font-size: 0.9rem;
          font-weight: 600;
          color: #111827;
          background: #fef9c3;
          border: 1px solid #facc15;
          box-shadow: 0 10px 25px rgba(15,23,42,0.4);
          z-index: 999;
        }

        .toast.negative {
          background: #fee2e2;
          border-color: #ef4444;
        }

        .pill-muted {
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15,23,42,0.08);
          color: #e5e7eb;
          font-size: 0.8rem;
        }

        .countdown-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          background: rgba(15,23,42,0.85);
          color: #f9fafb;
          border: 1px solid rgba(148,163,184,0.8);
        }

        .timer-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }

        .timer-dot.low-time {
          background: #f97316;
        }

        .timer-dot.critical {
          background: #ef4444;
        }

        .join-card {
          max-width: 480px;
          margin: 0 auto;
          padding: 20px 18px 18px 18px;
          border-radius: 24px;
          background: rgba(15,23,42,0.92);
          border: 1px solid rgba(148,163,184,0.7);
          box-shadow: 0 18px 45px rgba(15,23,42,0.9);
          color: #e5e7eb;
        }

        .join-card input {
          width: 100%;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.7);
          background: rgba(15,23,42,0.95);
          color: #f9fafb;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .join-card input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99,102,241,0.5);
        }

        .join-card button {
          width: 100%;
          padding: 9px 12px;
          border-radius: 999px;
          border: none;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          background: linear-gradient(135deg, #6366f1, #0ea5e9);
          color: #f9fafb;
          box-shadow: 0 10px 30px rgba(37,99,235,0.7);
          transition: transform 0.15s ease, box-shadow 0.15s ease,
            opacity 0.15s ease;
        }

        .join-card button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 12px 35px rgba(37,99,235,0.9);
        }

        .join-card button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        .join-card small {
          display: block;
          margin-top: 8px;
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .task-card {
          position: relative;
          overflow: hidden;
        }

        .task-card::before {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0.9;
          pointer-events: none;
        }

        .task-content-inner {
          position: relative;
          z-index: 1;
        }

        .noise-bar {
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(90deg, #22c55e, #facc15, #f97316, #ef4444);
          margin-top: 8px;
        }

        .noise-bar-track {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: rgba(15,23,42,0.25);
        }

        .noise-bar-inner {
          height: 100%;
          border-radius: 999px;
        }

        .scan-error {
          color: #fee2e2;
          background: rgba(127,29,29,0.9);
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          margin-top: 6px;
          border: 1px solid rgba(248,113,113,0.9);
        }

        .location-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 500;
          background: rgba(15,23,42,0.85);
          color: #e5e7eb;
          border: 1px solid rgba(148,163,184,0.8);
        }

        .location-pill span {
          opacity: 0.9;
        }

        .location-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }

        .task-card input,
        .task-card textarea {
          font-family: inherit;
          color: #0f172a;
          border-radius: 10px;
          border: 1px solid #d1d5db;
          padding: 7px 9px;
          font-size: 0.95rem;
          outline: none;
          background: #ffffff;
          transition: border-color 0.15s ease, box-shadow 0.15s ease,
            background-color 0.15s ease;
        }

        .task-card input:focus,
        .task-card textarea:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(129,140,248,0.3);
          background-color: #f9fafb;
        }

        /* General button polish inside the task card */
        .task-card button {
          font-family: inherit;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 0.95rem;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: transform 0.1s ease, box-shadow 0.1s ease,
            opacity 0.1s ease;
          box-shadow: 0 4px 12px rgba(15,23,42,0.15);
        }

        .task-card button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(15,23,42,0.25);
        }

        .task-card button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* For BrainSparkNotes / MakeAndSnap etc, subtle bullet styling */
        .bullet-chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 0.8rem;
          background: rgba(15,23,42,0.06);
          margin: 0 4px 4px 0;
        }

        .bullet-chip span {
          opacity: 0.9;
        }

        /* AI feedback callout */
        .ai-feedback {
          margin-top: 10px;
          padding: 10px;
          border-radius: 12px;
          background: #eef2ff;
          border: 1px solid #c7d2fe;
          font-size: 0.85rem;
          color: #111827;
        }

        .ai-feedback strong {
          display: block;
          margin-bottom: 4px;
          font-size: 0.9rem;
        }

        /* NOISE SENSOR */
        .noise-fade {
          transition: opacity 0.3s ease, transform 0.3s ease;
        }

        /* TREAT BANNER */
        .treat-banner {
          position: fixed;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          padding: 8px 14px;
          border-radius: 999px;
          background: radial-gradient(circle at top, #22c55e, #15803d);
          color: #fefce8;
          font-size: 0.85rem;
          font-weight: 600;
          box-shadow: 0 15px 35px rgba(22,163,74,0.7);
          z-index: 999;
        }

        /* QR SCANNER SHELL */
        .scanner-shell {
          margin-top: 10px;
          border-radius: 18px;
          padding: 10px;
          background: rgba(15,23,42,0.9);
          border: 1px solid rgba(148,163,184,0.75);
          box-shadow: 0 15px 35px rgba(15,23,42,0.9);
        }

        /* TASK-LOCKED OVERLAY */
        .task-locked-overlay {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: radial-gradient(
            circle at top,
            rgba(15,23,42,0.3),
            rgba(15,23,42,0.9)
          );
          display: flex;
          align-items: center;
          justify-content: center;
          color: #f9fafb;
          font-weight: 600;
          font-size: 0.95rem;
          z-index: 20;
          text-align: center;
          padding: 14px;
        }

        /* PROGRESS LINE */
        .progress-line {
          width: 100%;
          height: 4px;
          border-radius: 999px;
          background: rgba(148,163,184,0.4);
          overflow: hidden;
          margin-top: 4px;
        }

        .progress-line-inner {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #22c55e, #0ea5e9);
          transition: width 0.25s ease-out;
        }

        /* JEOPARDY / BRAINSTORM BATTLE STYLING */
        .jeopardy-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 10px;
        }

        .jeopardy-card {
          padding: 12px 10px;
          border-radius: 12px;
          background: rgba(15,23,42,0.9);
          border: 1px solid rgba(148,163,184,0.7);
          color: #fef9c3;
          font-size: 0.85rem;
          text-align: center;
          box-shadow: 0 10px 25px rgba(15,23,42,0.8);
        }

        .jeopardy-card strong {
          display: block;
          margin-bottom: 4px;
          font-size: 0.95rem;
        }

        .jeopardy-card button {
          margin-top: 6px;
          width: 100%;
          border-radius: 999px;
          padding: 6px 8px;
          background: linear-gradient(135deg, #22c55e, #0ea5e9);
          color: #f9fafb;
        }

        /* MIND MAPPER background hints */
        .mindmap-hint-chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(15,23,42,0.06);
          font-size: 0.8rem;
        }

        .mindmap-hint-chip span {
          opacity: 0.9;
        }

        /* BRAIN SPARK NOTES decorative */
        .spark-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(251,191,36,0.15);
          border: 1px solid rgba(245,158,11,0.9);
          font-size: 0.8rem;
          color: #92400e;
        }

        .spark-badge span {
          font-size: 1rem;
        }

        /* FLASHCARDS RACE indicator */
        .race-indicator {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15,23,42,0.85);
          color: #f9fafb;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .race-indicator-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
        }

        /* MYSTERY CLUES header animation */
        @keyframes mystery-glow {
          0% {
            text-shadow: 0 0 4px rgba(56,189,248,0.3);
          }
          50% {
            text-shadow: 0 0 12px rgba(56,189,248,0.9);
          }
          100% {
            text-shadow: 0 0 4px rgba(56,189,248,0.3);
          }
        }

        /* HANGMAN header pulse */
        @keyframes hangman-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }

        /* MUSICAL CHAIRS header pulse */
        @keyframes mc-header-pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.04);
          }
        }

        /* JEOPARDY lightning */
        @keyframes lightning-flash {
          0%, 100% {
            opacity: 0;
          }
          40% {
            opacity: 1;
          }
        }

        /* PET-HEALTH BAR */
        .pet-health-bar-wrapper {
          width: 100%;
          height: 14px;
          border-radius: 999px;
          background: rgba(15,23,42,0.15);
          overflow: hidden;
          border: 1px solid rgba(15,23,42,0.3);
        }

        .pet-health-bar-inner {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #ef4444, #f97316, #22c55e);
          transition: width 0.3s ease-out;
        }

        .pet-health-label {
          font-size: 0.8rem;
          font-weight: 500;
          color: #0f172a;
          margin-bottom: 2px;
        }

        /* DIFF-DETECTIVE RACE BANNER */
        .diff-race-banner {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(248,250,252,0.85);
          border: 1px solid rgba(148,163,184,0.9);
          font-size: 0.75rem;
          color: #0f172a;
        }

        .diff-race-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }

        .diff-race-dot.leader {
          background: #f97316;
        }

        .diff-race-dot.finished {
          background: #22c55e;
        }

        .diff-race-time {
          font-variant-numeric: tabular-nums;
        }

        /* CONFETTI LAYER FOR PERFECT SCORE */
        .confetti-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 900;
          background: radial-gradient(
            circle at top,
            rgba(250,250,250,0.4),
            transparent 60%
          );
        }

        .confetti-piece {
          position: absolute;
          width: 8px;
          height: 12px;
          border-radius: 2px;
        }

        .confetti-piece:nth-child(odd) {
          background: #f97316;
        }

        .confetti-piece:nth-child(even) {
          background: #22c55e;
        }
      `}
      </style>

      {/* HEADER */}
      {joined && (
        <AnimatedLeaderboard
          leaderboard={leaderboard}
          showConfetti={recentlyScoredBig} // Trigger on big points
          currentTeamName={yourTeamName}
        />
      )}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 10,
        }}
      >
        <div>
          <header style={{ marginBottom: 4 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "1.4rem",
                color: "#ffffff",
              }}
            >
              Curriculate – Team Station
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              Join your teacher&apos;s room, then scan stations as you move.
            </p>
          </header>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {joined && (
              <span className="pill-muted">
                Team: <strong>{teamName || "…"}</strong>
              </span>
            )}
            {joined && (
              <span className="pill-muted">
                Room: <strong>{roomCode.toUpperCase()}</strong>
              </span>
            )}

            {stationInfo.id && (
              <span className="station-pill">
                <span
                  className="station-dot"
                  style={
                    stationInfo.color
                      ? { background: stationInfo.color }
                      : undefined
                  }
                />
                {stationInfo.label}
              </span>
            )}

            {roomLocation && (
              <span className="location-pill">
                <span className="location-dot" />
                <span>{roomLocation}</span>
              </span>
            )}

            {timerDisplay && (
              <span className="countdown-pill">
                <span
                  className={
                    remainingMs <= 15000
                      ? "timer-dot critical"
                      : remainingMs <= 30000
                      ? "timer-dot low-time"
                      : "timer-dot"
                  }
                />
                {timerDisplay}
              </span>
            )}

            <span className="score-pill">
              <span role="img" aria-label="sparkles">
                ✨
              </span>
              <span>{scoreTotal} pts</span>
            </span>
          </div>
        </div>

        <div style={{ textAlign: "right", minWidth: 140 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <button
              type="button"
              onClick={() => setUiTheme("modern")}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border:
                  uiTheme === "modern"
                    ? "2px solid rgba(59,130,246,0.9)"
                    : "1px solid rgba(148,163,184,0.7)",
                background:
                  uiTheme === "modern"
                    ? "rgba(191,219,254,0.35)"
                    : "rgba(15,23,42,0.15)",
                color: "#e5e7eb",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Theme 1
            </button>
            <button
              type="button"
              onClick={() => setUiTheme("bold")}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border:
                  uiTheme === "bold"
                    ? "2px solid rgba(248,250,252,0.9)"
                    : "1px solid rgba(148,163,184,0.6)",
                background:
                  uiTheme === "bold"
                    ? "rgba(15,23,42,0.9)"
                    : "rgba(15,23,42,0.25)",
                color: "#e5e7eb",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Theme 2
            </button>
            <button
              type="button"
              onClick={() => setUiTheme("minimal")}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border:
                  uiTheme === "minimal"
                    ? "2px solid rgba(15,23,42,0.85)"
                    : "1px solid rgba(148,163,184,0.6)",
                background:
                  uiTheme === "minimal"
                    ? "#e5e7eb"
                    : "rgba(249,250,251,0.85)",
                color: "#111827",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Theme 3
            </button>
          </div>

          {joined && (
            <button
              type="button"
              onClick={handleJoinAnotherRoom}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.6)",
                background: "rgba(239,68,68,0.15)",
                color: "#fecaca",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Join another room
            </button>
          )}

          <div
            style={{
              fontSize: "0.75rem",
              color: connected ? "#bbf7d0" : "#fecaca",
            }}
          >
            {connected ? "Connected to server" : "Connecting…"}
          </div>
          {statusMessage && (
            <div
              style={{
                marginTop: 2,
                fontSize: "0.75rem",
                color: "#fee2e2",
              }}
            >
              {statusMessage}
            </div>
          )}
        </div>
      </header>

      {/* JOIN CARD */}
      {!joined && (
        <main style={{ flex: 1, display: "flex", alignItems: "flex-start" }}>
          <div className="join-card">
            <h2
              style={{
                marginTop: 0,
                marginBottom: 6,
                fontSize: "1.1rem",
              }}
            >
              Join the room
            </h2>
            <p
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: "0.85rem",
                color: "#9ca3af",
              }}
            >
              Enter the code shown on the board, pick a team name,
              and list your team members.
            </p>

            <form onSubmit={handleJoin}>
              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    marginBottom: 4,
                  }}
                >
                  Room Code
                </label>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="e.g. ABC123"
                  style={{ textTransform: "uppercase" }}
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    marginBottom: 4,
                  }}
                >
                  Team Name
                </label>
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Your epic team name"
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    marginBottom: 4,
                  }}
                >
                  Team Members
                </label>
                {members.map((m, idx) => (
                  <input
                    key={idx}
                    value={m}
                    onChange={(e) => {
                      const copy = [...members];
                      copy[idx] = e.target.value;
                      setMembers(copy);
                    }}
                    placeholder={`Member ${idx + 1}`}
                    style={{ marginBottom: 6 }}
                  />
                ))}
              </div>

              <button type="submit" disabled={!canJoin || joiningRoom}>
                {joiningRoom ? "Joining…" : "Join Room"}
              </button>

              <small>
                Tip: you can add more members later if your teacher allows.
              </small>
            </form>
          </div>
        </main>
      )}

      {/* MAIN TASK AREA */}
      {joined && (
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            marginTop: 8,
            gap: 8,
          }}
        >
          {/* Noise/temperature bar */}
          <section>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#e5e7eb" }}>
                Classroom Noise
              </div>
              {noiseState.enabled && (
                <div style={{ fontSize: "0.75rem", color: "#e5e7eb" }}>
                  Target:{" "}
                  <span style={{ fontWeight: 600 }}>{noiseState.threshold}</span>
                </div>
              )}
            </div>
            <div className="noise-bar-track noise-fade">
              <div
                className="noise-bar-inner"
                style={{
                  width: `${Math.min(Math.max(noiseState.level * 100, 0), 100)}%`,
                  opacity: noiseBarOpacity,
                }}
              />
            </div>
          </section>

          {/* Progress */}
          {progressLabel && (
            <div style={{ textAlign: "right", fontSize: "0.8rem" }}>
              <div style={{ color: "#e5e7eb", fontWeight: 600 }}>{progressLabel}</div>
              {currentTaskNumber && totalTasks && (
                <div className="progress-line">
                  <div
                    className="progress-line-inner"
                    style={{
                      width: `${Math.round((currentTaskNumber / totalTasks) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

    {joined && postPhase === "mood" && !tasksetComplete && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
        }}
      >
        <MoodCheckInTask
          socket={socket}
          roomCode={roomCode}
          teamId={teamId}
          memberNames={members}
          onSubmit={(payload) => {
            // Ensure handleSubmitAnswer recognizes it as mood-checkin
            handleSubmitAnswer({ type: TASK_TYPES.MOOD_CHECKIN, ...payload })
          }}
        />
      </section>
    )}  

    {joined && postPhase === "treasure" && !tasksetComplete && !currentTask && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
        }}
      >
        <TreasureRunner
          onSubmit={(payload) => {
            handleSubmitAnswer({ type: TASK_TYPES.TREASURE_RUNNER, ...payload })
          }}
        />
        <div style={{ marginTop: 10, fontWeight: 700, opacity: 0.8, textAlign: "center" }}>
          Waiting for your first task…
        </div>
      </section>
    )}
          
{/* POST-TASK FEEDBACK (after last task, before trophy) */}
{postPhase === "feedback" && !tasksetComplete && (
  <section
    style={{
      marginTop: 12,
      padding: 16,
      borderRadius: 18,
      background: "rgba(255,255,255,0.92)",
      border: "1px solid rgba(15,23,42,0.12)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
    }}
  >
    <MultiPlayerFeedbackTask
      roomCode={roomCode}
      teamId={teamId}
      teamName={teamName}
      socket={socket}
      onSubmit={(payload) => {
        // send to server if it’s listening
        try {
          socket.emit("feedback:submit", payload);
        } catch {}
        setPostPhase("trophy");
        setTasksetComplete(true);
        // refresh scores for final trophy
        socket.emit("room:request-state", { teamId });
      }}
    />
  </section>
)}

          {/* TASKSET COMPLETE SCREEN */}
{tasksetComplete && (
  <section
    style={{
      marginTop: 12,
      padding: 16,
      borderRadius: 18,
      background: "rgba(255,255,255,0.92)",
      border: "1px solid rgba(15,23,42,0.12)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: 6 }}>
      🎉 Victory!
    </div>
    <div style={{ fontSize: "1rem", opacity: 0.85, marginBottom: 12 }}>
      Task set complete — great work.
    </div>

    <div style={{ fontSize: "1.15rem", fontWeight: 800, marginBottom: 14 }}>
      Your Team: {teamName || "Team"} — {typeof scoreTotal === "number" ? scoreTotal : 0} pts
    </div>

    <AnimatedLeaderboard
      leaderboard={leaderboard}
      showConfetti={true}
      currentTeamName={teamName || null}
    />

    <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => socket.emit("room:request-state", { teamId })}
        className="border rounded-full px-4 py-2"
        style={{ background: "#0ea5e9", color: "#fff", fontWeight: 700 }}
      >
        Refresh scores
      </button>
      <button
        type="button"
        onClick={handleJoinAnotherRoom}
        className="border rounded-full px-4 py-2"
        style={{ background: "#111827", color: "#fff", fontWeight: 700 }}
      >
        Join another room
      </button>
    </div>
  </section>
)}

{/* SCANNER PANEL (shows whenever scannerActive is true) */}
{scannerActive && !tasksetComplete && (
          <section
            style={{
              marginTop: 6,
              padding: 16,
              borderRadius: 18,
              background: (assignedColor || stationInfo?.color || "black"),
              color: ((assignedColor || stationInfo?.color) === "yellow") ? "#0f172a" : "#fff",
              border: "2px solid rgba(255,255,255,0.55)",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ fontSize: "1.35rem", fontWeight: 900, letterSpacing: 0.4 }}>
              {(() => {
                const colorUpper = String(assignedColor || stationInfo?.color || "").toUpperCase();
                const locationUpper = String(roomLocation || "").toUpperCase();

                if (!colorUpper) return "Scan station QR code";

                // Multi-room only: show location + colour
                if (isMultiRoom && enforceLocation && locationUpper) {
                  return expectedColor ? `Scan QR Code at ${destinationText}` : "Scan station QR code";
                }

                // Single-room: colour only
                return `Scan QR Code at ${colorUpper}`;
              })()}
            </div>

            <div style={{ fontSize: 14, opacity: 0.95, marginTop: 4 }}>
              Get ready to Curriculate!
            </div>

            <div
              style={{
                marginTop: 12,
                background: "rgba(0,0,0,0.25)",
                borderRadius: 14,
                overflow: "hidden",
                border: "2px solid rgba(255,255,255,0.55)",
              }}
            >
              <section className="scanner-shell" style={{ textAlign: "center", margin: "24px 0" }}>
                <div style={{
                  backgroundColor: assignedColor ? `var(--${assignedColor}-500, #e5e7eb)` : "#e5e7eb",
                  borderRadius: 16,
                  padding: 16,
                  display: "inline-block",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                  maxWidth: "90vw",
                }}>
                  {scannerActive && (
                    <div style={{ position: "relative", width: "100%" }}>
                      <QrScanner onScan={handleScan} onError={setScanError} />
                    {waitingForLaunch && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          textAlign: "center",
                          padding: 20,
                          fontSize: 28,
                          fontWeight: 800,
                          color: "white",
                          textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                          pointerEvents: "none",
                        }}
                      >
                        Waiting for Curriculate to Launch...
                      </div>
                    )}
                  </div>
                )}
                  {scanError && (
                    <div className="scan-error" style={{ marginTop: 12, color: "#ef4444", fontWeight: 600 }}>
                      ⚠ {scanError}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {scanStatus === "ok" && (
              <div style={{ marginTop: 10, fontWeight: 800 }}>
                ✅ Correct station — waiting for your next task…
              </div>
            )}
          </section>
        )}
        
          {/* TASK CARD (only when not gated) */}
          {joined && postPhase === "tasks" && !currentTask && !mustScan && !tasksetComplete && waitingForLaunch && (
            <section
              style={{
                marginTop: 10,
                padding: 16,
                borderRadius: 18,
                background: "rgba(15,23,42,0.9)",
                border: "1px solid rgba(148,163,184,0.75)",
                color: "#f9fafb",
                textAlign: "center",
                boxShadow: "0 16px 40px rgba(15,23,42,0.95)",
              }}
            >
              <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>Getting your first activity ready…</div>
              <div style={{ marginTop: 6, opacity: 0.9 }}>
                Next up: <strong>Mood Check-in</strong>, then <strong>Treasure Runner</strong>. If this takes more than a few
                seconds, rescan or ask your teacher.
              </div>
            </section>
          )}

          {joined && postPhase === "tasks" && !!currentTask && !hardMustScan && !tasksetComplete && (
            <section
              className="task-card"
              style={{
                ...baseTaskCardStyle,
                ...(isMotionMission || isPetFeeding || isRecordAudio || isJeopardy
                  ? { background: "transparent", padding: 0, border: "none", boxShadow: "none" }
                  : { background: taskCardBackground }),
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: 6,
                  fontSize: responseHeadingFontSize,
                  letterSpacing: 0.2,
                  color: "#0f172a",
                  ...(musicalChairsHeaderStyle || {}),
                  ...(mysteryHeaderStyle || {}),
                  ...(hangmanHeaderStyle || {}),
                }}
              >
                {currentTaskNumber && (
                  <div style={{ marginBottom: 8, fontSize: "0.8rem", color: "#4b5563" }}>{progressLabel}</div>
                )}
                {currentTask.title || currentTask.name || "Task"}
              </h2>
              <div
                className="task-content-inner"
                style={{
                  position: "relative",
                  fontSize: responseFontSize,
                  lineHeight: 1.5,
                  minHeight: isMotionMission || isPetFeeding ? "60vh" : undefined,
                }}
              >
                <TaskErrorBoundary onError={(err) => setTaskRenderError(err)} fallback={
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={endReviewAndReturnToScan}
                      className="border rounded-full px-4 py-2"
                      style={{ background: "#111827", color: "#fff", fontWeight: 700 }}
                    >
                      Back to scan
                    </button>
                  </div>
                }>
                <TaskRunner
                  key={
                    currentTask?.id ??
                    currentTask?._id ??
                    currentTaskIndex ??
                    currentTask?.prompt ??
                    "task"
                  }
                  task={themedTask}
                  taskTypes={TASK_TYPES}
                  onSubmit={handleSubmitAnswer}
                  submitting={submitting}
                  onAnswerChange={setCurrentAnswerDraft}
                  answerDraft={currentAnswerDraft}
                  disabled={taskLocked || submitting}
                  mode={taskLocked ? "review" : "play"}
                  review={reviewState}
                  socket={socket}
                  roomCode={roomCode}
                  playerTeam={{ id: teamId, teamName }}
                  memberNames={members}
                  partnerAnswer={partnerAnswer}
                  showPartnerReply={showPartnerReply}
                  onPartnerReply={(replyText) => {
                    if (!roomCode || !joined || !currentTask || teamId == null) return;

                    socket.emit("collab:reply", {
                      roomCode: roomCode.trim().toUpperCase(),
                      teamId,
                      taskIndex:
                        typeof currentTaskIndex === "number" && currentTaskIndex >= 0
                          ? currentTaskIndex
                          : null,
                      reply: replyText,
                    });
                  }}
                />
                </TaskErrorBoundary>
              </div>

              {taskLocked && (
                <div className="task-locked-overlay">
                  <style>{`
                    @keyframes matchPopIn {
                      from { transform: translateY(6px) scale(0.98); opacity: 0; }
                      to   { transform: translateY(0px) scale(1); opacity: 1; }
                    }
                  `}</style>

                  {postSubmitSecondsLeft != null && (() => {
                    // Determine total lock duration safely for progress bar
                    const lockTotal =
                      typeof reviewState?.secondsLeft === "number"
                        ? reviewState.secondsLeft
                        : (typeof postSubmitSecondsLeft === "number"
                            ? postSubmitSecondsLeft
                            : DEFAULT_POST_SUBMIT_SECONDS);

                    const percent =
                      lockTotal > 0
                        ? Math.round((postSubmitSecondsLeft / lockTotal) * 100)
                        : 0;

                    return (
                      <div style={{ width: "100%" }}>
                        <div>
                          Review your answer… <br />
                          <span
                            style={{
                              fontVariantNumeric: "tabular-nums",
                              fontSize: "1.1rem",
                            }}
                          >
                            {postSubmitSecondsLeft}s
                          </span>
                        </div>

                        {/* Countdown bar */}
                        <div style={{ marginTop: 12 }}>
                          <div
                            style={{
                              height: 3,
                              borderRadius: 999,
                              background: "rgba(255,255,255,0.25)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${percent}%`,
                                background: "rgba(255,255,255,0.85)",
                                transition: "width 200ms linear",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                      {/* Matching answer reveal during lock */}
                      {/* Matching answer reveal during lock (highlight + animate + percent) */}
                      {currentTask?.taskType === "matching" && (() => {
                        const data = buildMatchingReveal(currentTask, reviewState);
                        if (!data) return null;

                        const { rows, correctCount, totalPairs, percent } = data;
                        const pointsEarned = typeof reviewState?.points === "number" ? reviewState.points : null;
                        const maxPoints = typeof currentTask?.points === "number" ? currentTask.points : null;

                        return (
                          <div
                            style={{
                              marginTop: 12,
                              width: "100%",
                              background: "rgba(255,255,255,0.14)",
                              border: "1px solid rgba(255,255,255,0.25)",
                              borderRadius: 12,
                              padding: 12,
                              textAlign: "left",
                            }}
                          >
                            {/* Summary row */}
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                              <div style={{ fontWeight: 900 }}>Matching results</div>
                              <div style={{ fontWeight: 900 }}>
                                {percent}% ({correctCount}/{totalPairs})
                                {pointsEarned != null ? ` • +${pointsEarned}` : ""}
                                {maxPoints != null ? `/${maxPoints}` : ""}
                              </div>
                            </div>

                            {/* Percent bar */}
                            <div
                              style={{
                                marginTop: 8,
                                height: 10,
                                borderRadius: 999,
                                background: "rgba(0,0,0,0.18)",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${percent}%`,
                                  height: "100%",
                                  borderRadius: 999,
                                  background: percent >= 80 ? "rgba(34,197,94,0.9)" : percent >= 50 ? "rgba(250,204,21,0.9)" : "rgba(239,68,68,0.9)",
                                  transition: "width 250ms ease",
                                }}
                              />
                            </div>

                            {/* Pair reveals */}
                            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                              {rows.map((r, i) => {
                                const bg = r.isCorrect
                                  ? "rgba(34,197,94,0.22)"
                                  : r.isAnswered
                                  ? "rgba(239,68,68,0.22)"
                                  : "rgba(0,0,0,0.14)";

                                const border = r.isCorrect
                                  ? "1px solid rgba(34,197,94,0.45)"
                                  : r.isAnswered
                                  ? "1px solid rgba(239,68,68,0.45)"
                                  : "1px solid rgba(255,255,255,0.18)";

                                const icon = r.isCorrect ? "✅" : r.isAnswered ? "❌" : "⏺️";

                                return (
                                  <div
                                    key={`${r.leftId}:${r.rightId}`}
                                    style={{
                                      padding: 10,
                                      borderRadius: 12,
                                      background: bg,
                                      border,
                                      animation: "matchPopIn 240ms ease both",
                                      animationDelay: `${i * 60}ms`,
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                      <div style={{ fontWeight: 800 }}>{r.left}</div>
                                      <div style={{ fontWeight: 900, opacity: 0.95 }}>{icon}</div>
                                    </div>

                                    <div style={{ marginTop: 6, fontSize: "0.95rem", opacity: 0.98 }}>
                                      <div>
                                        <span style={{ opacity: 0.85 }}>Correct:</span>{" "}
                                        <span style={{ fontWeight: 800 }}>{r.right}</span>
                                      </div>

                                      {r.isAnswered && !r.isCorrect && (
                                        <div style={{ marginTop: 4 }}>
                                          <span style={{ opacity: 0.85 }}>You chose:</span>{" "}
                                          <span style={{ fontWeight: 800 }}>{r.studentRightText ?? "—"}</span>
                                        </div>
                                      )}

                                      {!r.isAnswered && (
                                        <div style={{ marginTop: 4, opacity: 0.85 }}>
                                          You didn’t match this one.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ✅ Objective answer key during lock */}
                      {isObjectiveTask(currentTask) && (() => {
                        const key = buildObjectiveAnswerKey(currentTask);
                        if (!key) return null;

                        if (key.rows) {
                          return (
                            <div style={{ marginTop: 12, width: "100%", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: 12, textAlign: "left" }}>
                              <div style={{ fontWeight: 800, marginBottom: 8 }}>{key.title || "Answer key"}</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {key.rows.map((r, i) => (
                                  <div key={i} style={{ padding: 8, borderRadius: 10, background: "rgba(0,0,0,0.12)" }}>
                                    <div style={{ fontWeight: 700 }}>{r.q}</div>
                                    <div style={{ marginTop: 4, opacity: 0.95 }}>
                                      Correct: <strong>{r.a}</strong>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        if (key.ordered) {
                          return (
                            <div style={{ marginTop: 12, width: "100%", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: 12, textAlign: "left" }}>
                              <div style={{ fontWeight: 800, marginBottom: 8 }}>{key.title || "Correct order"}</div>
                              <ol style={{ margin: 0, paddingLeft: 20 }}>
                                {key.ordered.map((it) => (
                                  <li key={it.n} style={{ marginBottom: 6 }}>
                                    {it.text}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          );
                        }

                        if (key.buckets) {
                          return (
                            <div style={{ marginTop: 12, width: "100%", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: 12, textAlign: "left" }}>
                              <div style={{ fontWeight: 800, marginBottom: 8 }}>{key.title || "Correct categories"}</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {key.buckets.map((b, idx) => (
                                  <div key={idx} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.12)" }}>
                                    <div style={{ fontWeight: 800, marginBottom: 6 }}>{b.bucket}</div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                      {(b.items || []).map((txt, j) => (
                                        <span key={j} style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.22)" }}>
                                          {txt}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {Array.isArray(key.unassigned) && key.unassigned.length > 0 && (
                                  <div style={{ marginTop: 6, opacity: 0.9 }}>
                                    Unassigned: <strong>{key.unassigned.join(", ")}</strong>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }

                        return null;
                      })()}
                </div>
              )}
              </section>
            )}
          {/* Must scan gate (message only; scanner itself is already above when scannerActive) */}
          {joined && currentTask && hardMustScan && (
            <section
              style={{
                marginTop: 10,
                padding: 16,
                borderRadius: 18,
                background: "rgba(15,23,42,0.9)",
                border: "1px solid rgba(248,250,252,0.8)",
                color: "#fefce8",
                textAlign: "center",
                boxShadow: "0 16px 40px rgba(15,23,42,0.95)",
              }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 700 }}>
                🚪 Scan the correct station first
              </div>
              <p style={{ marginTop: 6, fontSize: "0.9rem", marginBottom: 0 }}>
                Your teacher has locked this task to a specific station. Scan the station’s
                QR code to unlock it.
              </p>
            </section>
          )}
        </main>
      )}

      {/* TREAT BANNER */}
      {treatMessage && <div className="treat-banner">{treatMessage}</div>}

      {/* POINT TOAST */}
      {pointToast && (
        <div className={`toast ${pointToast.positive ? "" : "negative"}`}>
          {pointToast.message}
        </div>
      )}

      {/* CONFETTI LAYER */}
      {showConfetti && (
        <div className="confetti-layer">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 40}%`,
                transform: `rotate(${Math.random() * 45}deg)`,
              }}
            />
          ))}
        </div>
      )}

      {/* FOOTER STRIP */}
      <div
        style={{
          marginTop: 16,
          height: "50vh",
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          backgroundColor: assignedColor
            ? assignedColor
            : stationInfo?.color
            ? stationInfo.color
            : "#e5e7eb",
          boxShadow: "0 -4px 12px rgba(15,23,42,0.25)",
        }}
      />
    </div>
  );
}

export default StudentApp;