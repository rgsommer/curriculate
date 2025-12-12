// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import QrScanner from "./components/QrScanner.jsx";
import NoiseSensor from "./components/NoiseSensor.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import { API_BASE_URL } from "./config.js";
import { COLORS } from "@shared/colors.js";

// Build marker so you can confirm the deployed bundle
console.log("STUDENT BUILD MARKER v2025-12-12-AE, API_BASE_URL:", API_BASE_URL);

// ---------------------------------------------------------------------
// Station colour helpers – numeric ids (station-1, station-2…)
// ---------------------------------------------------------------------
const COLOR_NAMES = COLORS;

// For now, LiveSession-launched tasks are assumed to use "Classroom"
const DEFAULT_LOCATION = "Classroom";

function getReadableTextColor(bg) {
  // Simple safe default: white for your station palette
  // If you ever add very light colors, we can switch to dynamic contrast.
  return "#fff";
}

function formatScanLabel({ isMultiRoom, locationLabel, color }) {
  const colorUpper = (color || "").toUpperCase();
  if (isMultiRoom && locationLabel) return `Scan at ${locationLabel.toUpperCase()} ${colorUpper}`;
  return `Scan at ${colorUpper}`;
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

  // Default fallback
  return { id: s, color: null, label: s.toUpperCase() };
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
// Main component
// ---------------------------------------------------------------------

function StudentApp() {
  console.log("STUDENTAPP COMPONENT RENDERED — CLEAN VERSION");

  // Theme selector (must be inside component)
  const [uiTheme, setUiTheme] = useState("modern"); // "modern" | "bold" | "minimal"
  const themeShell = getThemeShell(uiTheme);

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState(["", "", ""]);

  // Collaboration
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [showPartnerReply, setShowPartnerReply] = useState(false);

  // Persistent identifiers
  const [teamId, setTeamId] = useState(null); // TeamSession _id from backend
  const [teamSessionId, setTeamSessionId] = useState(null);
  const lastStationIdRef = useRef(null);

  // Station + scanner state
  const [assignedStationId, setAssignedStationId] = useState(null);
  const [assignedColor, setAssignedColor] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState(null);

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

  // Whether to enforce location (fixed-station / multi-room hunts)
  const [enforceLocation, setEnforceLocation] = useState(false);

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

      const noiseCfg = state.noiseConfig || {};
      setNoiseState((prev) => ({
        ...prev,
        enabled: !!noiseCfg.enabled,
        threshold:
          typeof noiseCfg.threshold === "number" ? noiseCfg.threshold : 0,
      }));
    };

    const handleTaskAssigned = (payload) => {
      if (!payload) return;
      setCurrentTask(payload.task || payload || null);
      const idx = (typeof payload.taskIndex === "number") ? payload.taskIndex : (typeof payload.index === "number" ? payload.index : null);
      setCurrentTaskIndex(idx);
      const total = (typeof payload.totalTasks === "number") ? payload.totalTasks : (typeof payload.total === "number" ? payload.total : null);
      setTasksetTotalTasks(total);

      const limit = payload.timeLimitSeconds || null;
      setTimeLimitSeconds(limit);

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
        taskIndex:
          typeof taskIndex === "number" && taskIndex >= 0 ? taskIndex : null,
        method: method || null,
        correctAnswer: correctAnswer ?? null,
      });

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

      if (typeof reviewPauseSeconds === "number" && reviewPauseSeconds > 0) {
        setTaskLocked(true);
        setPostSubmitSecondsLeft(reviewPauseSeconds);

        if (postSubmitTimerRef.current) {
          clearInterval(postSubmitTimerRef.current);
        }

        postSubmitTimerRef.current = setInterval(() => {
          setPostSubmitSecondsLeft((prev) => {
            if (prev == null || prev <= 1) {
              clearInterval(postSubmitTimerRef.current);
              postSubmitTimerRef.current = null;
              setTaskLocked(false);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      }
    };

    const handleNoiseUpdate = (payload) => {
      if (!payload) return;
      setNoiseState((prev) => ({
        ...prev,
        level:
          typeof payload.level === "number" ? payload.level : prev.level,
        brightness:
          typeof payload.brightness === "number"
            ? payload.brightness
            : prev.brightness,
      }));
    };

    const handleTreat = (payload) => {
      if (!payload) return;
      if (payload.type === "point-bonus") {
        setTreatMessage(
          payload.message || "Surprise point bonus for your team!"
        );
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
    socket.on("new-task", (payload) => handleTaskAssigned({ task: payload, index: payload?.taskIndex ?? payload?.index ?? 0 }));
    socket.on("task:scored", handleTaskScored);
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
      socket.off("noise:update", handleNoiseUpdate);
      socket.off("treat:event", handleTreat);
      socket.off("collab:partner-answer", handleCollabPartner);
      socket.off("collab:reply", handleCollabReply);
    };
  }, [teamId, reviewPauseSeconds]);

  // -------------------------------------------------------------------
  // Auto-open scanner when a scan is required
  // -------------------------------------------------------------------
  const mustScan =
    enforceLocation &&
    assignedStationId &&
    scannedStationId !== assignedStationId;

  useEffect(() => {
    if (mustScan) setScannerActive(true);
  }, [mustScan]);

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
      const alertAudio = new Audio(
        "https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"
      );
      alertAudio.volume = 0.15;
      sndAlert.current = alertAudio;

      const treatAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg"
      );
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

  const handleJoin = (e) => {
    e.preventDefault();
    if (!canJoin || joiningRoom) return;

    setJoiningRoom(true);
    setStatusMessage("");

    const payload = {
      roomCode: roomCode.trim().toUpperCase(),
      teamName: teamName.trim(),
      members: members.filter((m) => m.trim().length > 0),
    };

    socket.emit("student:join-room", payload, (response) => {
      setJoiningRoom(false);
      const ok = response && (response.ok === true || response.success === true);
      const errMsg = response?.error;
      if (!ok) {
        setStatusMessage(
          response?.error || "Could not join. Check the code with your teacher."
        );
        return;
      }

      setJoined(true);
      setStatusMessage("");
      const tid = response.teamId || response.teamSessionId;
      setTeamId(tid);
      setTeamSessionId(response.teamSessionId || response.teamId || null);

      if (response.currentTask) {
        setCurrentTask(response.currentTask.task || null);
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
        }
      }

      if (response.stationId) {
        const stationInfo = normalizeStationId(response.stationId);
        setAssignedStationId(stationInfo.id);
        setAssignedColor(stationInfo.color || null);
        lastStationIdRef.current = stationInfo.id;
      }

      const locSlug =
        response.locationSlug ||
        roomLocationFromStateRef.current ||
        DEFAULT_LOCATION;
      setRoomLocation(locSlug);
      roomLocationFromStateRef.current = locSlug;

      const noiseCfg = response.noiseConfig || {};
      setNoiseState((prev) => ({
        ...prev,
        enabled: !!noiseCfg.enabled,
        threshold:
          typeof noiseCfg.threshold === "number" ? noiseCfg.threshold : 0,
      }));
    });
  };

  // Auto-open scanner immediately after joining a room
  useEffect(() => {
    if (joined) setScannerActive(true);
  }, [joined]);

  const handleSubmitAnswer = (answerPayload) => {
    if (!roomCode || !joined || !currentTask || submitting || taskLocked) {
      return;
    }

    setSubmitting(true);

    const payload = {
      roomCode: roomCode.trim().toUpperCase(),
      teamId,
      taskId: currentTask._id || currentTask.id,
      taskIndex:
        typeof currentTaskIndex === "number" && currentTaskIndex >= 0
          ? currentTaskIndex
          : null,
      answer: answerPayload,
    };

    socket.emit("submit-answer", payload, (response) => {
      setSubmitting(false);
      if (!response || response.error) {
        console.warn("Submit error:", response?.error || "Unknown error");
        setStatusMessage(
          response?.error || "There was a problem submitting. Try again."
        );
        return;
      }

      setStatusMessage("");
      setTaskLocked(true);

      if (!response.aiScoring && !response.objectiveScoring) {
        if (typeof reviewPauseSeconds === "number" && reviewPauseSeconds > 0) {
          setPostSubmitSecondsLeft(reviewPauseSeconds);

          if (postSubmitTimerRef.current) {
            clearInterval(postSubmitTimerRef.current);
          }
          postSubmitTimerRef.current = setInterval(() => {
            setPostSubmitSecondsLeft((prev) => {
              if (prev == null || prev <= 1) {
                clearInterval(postSubmitTimerRef.current);
                postSubmitTimerRef.current = null;
                setTaskLocked(false);
                return null;
              }
              return prev - 1;
            });
          }, 1000);
        }
      }

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

  setScannedStationId(norm.id);
  const roomCode = (roomState?.roomCode || "").trim().toUpperCase();

  socket.emit(
    "station:scan",
    {
      roomCode: roomCode.trim().toUpperCase(),
      teamId: roomState?.teamId,            // if you track it
      stationColor: payload.stationColor,   // from QR
      location: payload.location,           // from QR if present
    },
    (response) => {
      if (!response || response.error) {
        setScanError(response?.error || "Scan was not accepted.");
        return;
      }

      if (response.stationId) {
        const info = normalizeStationId(response.stationId);
        setAssignedStationId(info.id);
        setAssignedColor(info.color || null);
        lastStationIdRef.current = info.id;
      }

      setScannerActive(false);
    }
  );
};


  // ─────────────────────────────────────────────
  // Location enforcement & station gating
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!currentTask) {
      setEnforceLocation(false);
      return;
    }
    const cfg = currentTask.config || {};
    const enforce = !!cfg.requireScan && !!cfg.stationBased;
    setEnforceLocation(enforce);
  }, [currentTask]);

  // ─────────────────────────────────────────────
  // Derived values for UI
  // ─────────────────────────────────────────────

  const themedTask = currentTask
    ? {
        ...currentTask,
        locationSlug: normalizeLocationSlug(roomLocation),
      }
    : null;

  const stationInfo = normalizeStationId(assignedStationId);

  const noiseBarOpacity = noiseState.enabled ? noiseState.brightness : 0.08;

  const timerDisplay = timeLimitSeconds ? formatRemainingMs(remainingMs) : null;

  const responseFontSize = currentTask && currentTask.largeText ? "1.1rem" : "1rem";
  const responseHeadingFontSize =
    currentTask && currentTask.largeText ? "1.4rem" : "1.2rem";

  const isMotionMission =
    currentTask?.taskType === TASK_TYPES.MOTION_MISSION;
  const isPetFeeding = currentTask?.taskType === TASK_TYPES.PET_FEEDING;
  const isRecordAudio = currentTask?.taskType === TASK_TYPES.RECORD_AUDIO;

  const isJeopardy = currentTask?.taskType === TASK_TYPES.BRAINSTORM_BATTLE;
  const isFlashcardsRace =
    currentTask?.taskType === TASK_TYPES.FLASHCARDS_RACE;
  const isMadDash =
    currentTask?.taskType === TASK_TYPES.MAD_DASH ||
    currentTask?.taskType === TASK_TYPES.MAD_DASH_SEQUENCE;

  const isMakeAndSnap =
    currentTask?.taskType === TASK_TYPES.MAKE_AND_SNAP;

  const isMindMapper =
    currentTask?.taskType === TASK_TYPES.MIND_MAPPER;
  
  const isMultipleChoice =
    currentTask?.taskType === TASK_TYPES.MULTIPLE_CHOICE;

  const isMusicalChairs =
    currentTask?.taskType === TASK_TYPES.MUSICAL_CHAIRS;

  const musicalChairsHeaderStyle = isMusicalChairs
    ? {
        animation: "mc-header-pulse 1.4s ease-in-out infinite",
      }
    : {};

  const isMysteryClues =
    currentTask?.taskType === TASK_TYPES.MYSTERY_CLUES;

  const mysteryHeaderStyle = isMysteryClues
    ? {
        animation: "mystery-glow 1.6s ease-in-out infinite",
      }
    : {};

  const isOpenText = currentTask?.taskType === TASK_TYPES.OPEN_TEXT;
  const isPhoto = currentTask?.taskType === TASK_TYPES.PHOTO;
  const isBrainSparkNotes =
    currentTask?.taskType === TASK_TYPES.BRAIN_SPARK_NOTES;

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
    : isBrainSparkNotes
    ? "linear-gradient(135deg, #fef9c3 0%, #fee2e2 40%, #f9fafb 100%)"
    : "linear-gradient(135deg, #eef2ff 0%, #eff6ff 40%, #f9fafb 100%)";

  // Taskset progress
  const currentTaskNumber =
    typeof currentTaskIndex === "number" && currentTaskIndex >= 0
      ? currentTaskIndex + 1
      : null;

  const totalTasks =
    typeof tasksetTotalTasks === "number" && tasksetTotalTasks > 0
      ? tasksetTotalTasks
      : null;

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
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
              Join your teacher’s room
            </h2>
            <p
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: "0.85rem",
                color: "#9ca3af",
              }}
            >
              Enter the code your teacher shows on the board, pick a team name,
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
        <div style={{ color: "#e5e7eb", fontWeight: 600 }}>
          {progressLabel}
        </div>
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

    {/* TASK CARD */}
    {joined && currentTask && !mustScan && (
      <section
        className="task-card"
        style={{
          ...baseTaskCardStyle,
          ...(isMotionMission || isPetFeeding || isRecordAudio || isJeopardy
            ? {
                // Let MotionMissionTask / PetFeeding / RecordAudio own the look
                background: "transparent",
                padding: 0,
                border: "none",
                boxShadow: "none",
              }
            : {
                background: taskCardBackground,
              }),
        }}
      >
        <h2
          style={{
            marginTop: 0,
            marginBottom: 6,
            fontSize: responseHeadingFontSize,
            letterSpacing: 0.2,
            color: "#0f172a",
            ...musicalChairsHeaderStyle,
            ...mysteryHeaderStyle,
          }}
        >
          {currentTaskNumber && (
            <div
              style={{
                marginBottom: 8,
                fontSize: "0.8rem",
                color: "#4b5563",
              }}
            >
              {progressLabel}
            </div>
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
            socket={socket}
            roomCode={roomCode}
            playerTeam={teamName}
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
        </div>

        {taskLocked && (
          <div className="task-locked-overlay">
            {postSubmitSecondsLeft != null ? (
              <div>
                Locked while your teacher reviews… <br />
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "1.1rem",
                  }}
                >
                  {postSubmitSecondsLeft}s
                </span>
              </div>
            ) : (
              <div>Waiting for your teacher to unlock the next task…</div>
            )}
          </div>
        )}

        {lastTaskResult && lastTaskResult.aiFeedback && (
          <div className="ai-feedback">
            <strong>AI Feedback</strong>
            <div>{lastTaskResult.aiFeedback}</div>
            {shortAnswerReveal && (
              <div style={{ marginTop: 6, fontSize: "0.8rem" }}>
                <strong>Sample correct answer:</strong> {shortAnswerReveal}
              </div>
            )}
          </div>
        )}
      </section>
    )}

    {/* Must scan gate (scanner ALWAYS shown when mustScan is true) */}
    {joined && currentTask && mustScan && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: expectedColor || "black",
          border: "2px solid rgba(255,255,255,0.55)",
          color: "#fff",
          textAlign: "center",
          boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ fontSize: "1.4rem", fontWeight: 900, letterSpacing: 0.5 }}>
          {isMultiRoom && expectedLocationLabel
            ? `Scan at ${expectedLocationLabel.toUpperCase()} ${String(expectedColor || "").toUpperCase()}`
            : `Scan at ${String(expectedColor || "").toUpperCase()}`}
        </div>

        <p
          style={{
            marginTop: 6,
            fontSize: "0.95rem",
            marginBottom: 12,
            opacity: 0.95,
          }}
        >
          This task is locked to a station. Scan the station QR code to unlock it.
        </p>

        <div
          style={{
            background: "rgba(0,0,0,0.25)",
            borderRadius: 14,
            overflow: "hidden",
            border: "2px solid rgba(255,255,255,0.55)",
          }}
        >
          <section className="scanner-shell">
            <QrScanner onScan={handleScan} onError={setScanError} />
            {scanError && (
              <div className="scan-error" style={{ padding: 10 }}>
                ⚠ {scanError}
              </div>
            )}
          </section>
        </div>
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
            ? `var(--${assignedColor}-500, #e5e7eb)`
            : "#e5e7eb",
          boxShadow: "0 -4px 12px rgba(15,23,42,0.25)",
        }}
      />
    </div>
  );
}

export default StudentApp;