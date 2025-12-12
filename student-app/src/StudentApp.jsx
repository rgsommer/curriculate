// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import QrScanner from "./components/QrScanner.jsx";
import NoiseSensor from "./components/NoiseSensor.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import { API_BASE_URL } from "./config.js";

// Build marker so you can confirm the deployed bundle
console.log("STUDENT BUILD MARKER v2025-12-11 953PM, API_BASE_URL:", API_BASE_URL);

// ---------------------------------------------------------------------
// Station colour helpers – numeric ids (station-1, station-2…)
// ---------------------------------------------------------------------

const COLOR_NAMES = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
];

// For now, LiveSession-launched tasks are assumed to use "Classroom"
const DEFAULT_LOCATION = "Classroom";

// Normalize a human-readable station id like "Red" or "station-1" into a consistent shape
function normalizeStationId(raw) {
  if (!raw || typeof raw !== "string") {
    return { id: null, color: null, label: "Unassigned" };
  }
  const trimmed = raw.trim();

  if (trimmed.startsWith("station-")) {
    const parts = trimmed.split("-");
    const idx = parseInt(parts[1], 10);
    const colorName = COLOR_NAMES[idx - 1] || null;
    return {
      id: trimmed,
      color: colorName,
      label: colorName
        ? `${colorName.charAt(0).toUpperCase()}${colorName.slice(1)}`
        : trimmed,
    };
  }

  const maybeColour = trimmed.toLowerCase();
  if (COLOR_NAMES.includes(maybeColour)) {
    return {
      id: `station-${COLOR_NAMES.indexOf(maybeColour) + 1}`,
      color: maybeColour,
      label: trimmed,
    };
  }

  return {
    id: trimmed,
    color: null,
    label: trimmed,
  };
}

// Normalize location slug
function normalizeLocationSlug(raw) {
  if (!raw || typeof raw !== "string") return null;
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

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

function formatMs(ms) {
  if (ms == null) return "";
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function buildAnswerReview(task) {
  if (!task || !task.type) return null;

  if (task.type === TASK_TYPES.MULTIPLE_CHOICE && task.options) {
    const correctIndex = task.correctIndex;
    if (
      typeof correctIndex === "number" &&
      task.options[correctIndex] != null
    ) {
      return {
        label: "Correct answer",
        value: task.options[correctIndex],
      };
    }
  }

  if (task.type === TASK_TYPES.TRUE_FALSE) {
    if (typeof task.correct === "boolean") {
      return {
        label: "Correct answer",
        value: task.correct ? "True" : "False",
      };
    }
  }

  if (task.type === TASK_TYPES.SHORT_ANSWER && task.rubric) {
    return {
      label: "Sample high-quality answer",
      value: task.rubric,
    };
  }

  return null;
}

// ---------------------------------------------------------------------
// Main Student App
// ---------------------------------------------------------------------
export default function StudentApp() {
  // Connection + room status
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState(["", "", ""]);
  const [teamId, setTeamId] = useState(null);
  const [teamSessionId, setTeamSessionId] = useState(null);
  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // UI theme – "modern" | "bold" | "minimal"
  const [uiTheme, setUiTheme] = useState("modern");

  // Station + scanning state
  const [assignedStationId, setAssignedStationId] = useState(null);
  const [assignedColor, setAssignedColor] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState(null);

  // Task + timer
  const [currentTask, setCurrentTask] = useState(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(null);
  const [tasksetTotalTasks, setTasksetTotalTasks] = useState(null);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(null);
  const [remainingMs, setRemainingMs] = useState(null);

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

  // For station-change detection
  const lastStationIdRef = useRef(null);

  // Student's current answer draft
  const [currentAnswerDraft, setCurrentAnswerDraft] = useState("");

  // Collaboration overlays
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [showPartnerReply, setShowPartnerReply] = useState(false);

  // Timers
  const countdownTimerRef = useRef(null);
  const postSubmitTimerRef = useRef(null);

  // Audio
  const [audioContext, setAudioContext] = useState(null);
  const sndAlert = useRef(null);
  const sndTreat = useRef(null);

  // Collab overlay dismissal
  const [showCorrectAnswerOverlay, setShowCorrectAnswerOverlay] =
    useState(false);

  // Join button gating
  const canJoin =
    roomCode.trim().length >= 2 &&
    teamName.trim().length >= 1 &&
    members.some((m) => m.trim().length > 0);

  // ─────────────────────────────────────────────
  // EFFECT: socket connection lifecycle
  // ─────────────────────────────────────────────
  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setStatusMessage("");

      // Try to resume existing team session if present
      try {
        const saved = sessionStorage.getItem("teamSession");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.roomCode && parsed.teamId) {
            setRoomCode(parsed.roomCode);
            setTeamId(parsed.teamId);
            setTeamSessionId(parsed.teamSessionId || null);
            setTeamName(parsed.teamName || "");
            setJoined(true);
          }
        }
      } catch (err) {
        console.warn("STUDENT: Unable to parse stored teamSession:", err);
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      setStatusMessage(
        "Disconnected from server. Trying to reconnect…"
      );
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setStatusMessage("Unable to connect. Check your internet?");
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error");
    };
  }, []);

  // ─────────────────────────────────────────────
  // Clean up timers on unmount
  // ─────────────────────────────────────────────
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
        "https://cdn.pixabay.com/download/audio/2021/08/04/audio_6e735e9f37.mp3?filename=ding-36029.mp3"
      );
      const treatAudio = new Audio(
        "https://cdn.pixabay.com/download/audio/2021/08/09/audio_e6ff0edb82.mp3?filename=correct-2-46134.mp3"
      );
      sndAlert.current = alertAudio;
      sndTreat.current = treatAudio;
    } catch (err) {
      console.warn("Could not preload audio:", err);
    }
  }, []);

  function unlockAudioForBrowser() {
    try {
      if (!audioContext) {
        const AC =
          window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        setAudioContext(ctx);
        if (ctx.state === "suspended") {
          ctx.resume();
        }
        return;
      }

      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
    } catch (err) {
      console.warn("Could not unlock audio context:", err);
    }
  }

  const tryPlayAlertSound = () => {
    if (sndAlert.current) {
      sndAlert.current.volume = 0.9;
      sndAlert.current
        .play()
        .catch((err) =>
          console.warn("Failed to play alert sound:", err)
        );
    }
  };

  const tryPlayTreatSound = () => {
    if (sndTreat.current) {
      sndTreat.current.volume = 0.9;
      sndTreat.current
        .play()
        .catch((err) =>
          console.warn("Failed to play treat sound:", err)
        );
    }
  };

  // ─────────────────────────────────────────────
  // Join room + submit handlers
  // ─────────────────────────────────────────────

  const handleJoin = () => {
    const finalRoom = roomCode.trim().toUpperCase();

    if (!finalRoom || !teamName.trim()) {
      alert("Please enter both a room code and team name.");
      return;
    }

    if (!connected) {
      alert("Not connected to server yet. Please wait a moment.");
      return;
    }

    unlockAudioForBrowser();

    const filteredMembers = members
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    setJoiningRoom(true);
    setStatusMessage(`Joining Room ${finalRoom}…`);

    const timeoutId = setTimeout(() => {
      setJoiningRoom(false);
      setStatusMessage("Join failed — timeout");
      alert("Join timed out. Is the teacher in the room?");
    }, 8000);

    socket.emit(
      "student:join-room",
      {
        roomCode: finalRoom,
        teamName: teamName.trim(),
        members: filteredMembers,
      },
      (ack) => {
        clearTimeout(timeoutId);

        if (!ack || !ack.ok) {
          setJoiningRoom(false);
          setStatusMessage("Join failed");
          alert(ack?.error || "Unable to join room.");
          return;
        }

        const teamSession = ack.teamSessionId || ack.teamId;

        setJoined(true);
        setJoiningRoom(false);
        setRoomCode(finalRoom);
        setTeamId(ack.teamId || teamSession);
        setTeamSessionId(teamSession);

        try {
          sessionStorage.setItem(
            "teamSession",
            JSON.stringify({
              roomCode: finalRoom,
              teamId: ack.teamId,
              teamSessionId: teamSession,
              teamName: teamName.trim(),
            })
          );
        } catch (err) {
          console.warn("STUDENT: Unable to persist teamSession:", err);
        }

        setEnforceLocation(!!ack.roomState?.enforceLocation);
        if (ack.roomState?.locationCode) {
          setRoomLocation(ack.roomState.locationCode);
          roomLocationFromStateRef.current =
            ack.roomState.locationCode;
        }

        const myTeam = ack.roomState?.teams?.[ack.teamId] || null;

        if (myTeam?.currentStationId) {
          const norm = normalizeStationId(myTeam.currentStationId);

          setAssignedStationId(myTeam.currentStationId);
          setAssignedColor(norm.color || null);
          setScannedStationId(null);
          setScannerActive(true);

          lastStationIdRef.current = myTeam.currentStationId;

          const colourLabel = norm.color
            ? ` ${norm.color.toUpperCase()}`
            : "";

          setStatusMessage(
            `Scan your${colourLabel} station to get started.`
          );
        } else {
          lastStationIdRef.current = null;
          setStatusMessage(
            "Waiting for your teacher to assign your station."
          );
          setScannerActive(false);
          setScannedStationId(null);
        }
      }
    );
  };

  const handleLeaveRoom = () => {
    if (!joined) return;

    const ok = window.confirm(
      "Leave this room and join a different one?"
    );
    if (!ok) return;

    try {
      socket.emit("student:leave-room", {
        roomCode,
        teamId,
        teamSessionId,
      });
    } catch (err) {
      console.warn("Error emitting student:leave-room:", err);
    }

    try {
      sessionStorage.removeItem("teamSession");
    } catch (err) {
      console.warn("Unable to clear teamSession:", err);
    }

    setJoined(false);
    setTeamId(null);
    setTeamSessionId(null);

    setAssignedStationId(null);
    setAssignedColor(null);
    setScannedStationId(null);
    setScannerActive(false);
    setScanError(null);

    setCurrentTask(null);
    setCurrentTaskIndex(null);
    setTasksetTotalTasks(null);
    setPostSubmitSecondsLeft(null);
    setLastTaskResult(null);
    setShortAnswerReveal(null);

    setTreatMessage(null);
    setNoiseState({
      enabled: false,
      threshold: 0,
      level: 0,
      brightness: 1,
    });

    lastStationIdRef.current = null;
    roomLocationFromStateRef.current = DEFAULT_LOCATION;

    setStatusMessage("Enter your new room code to get started.");
  };

  // ─────────────────────────────────────────────
  // QR SCAN HANDLER – enforce colour + station:scan
  // ─────────────────────────────────────────────
  const handleScannedCode = (code) => {
    if (!joined || !teamId) {
      setScanError("Join a room first, then scan a station.");
      return;
    }

    if (!assignedStationId) {
      setScanError(
        "Wait until your teacher assigns a station, then scan."
      );
      return;
    }

    const normAssigned = normalizeStationId(assignedStationId);
    const expectedColour = normAssigned.color;

    let scannedColour = null;
    let scannedLocationRaw = null;

    try {
      const url = new URL(code);
      const segments = url.pathname.split("/").filter(Boolean);

      if (segments.length >= 2) {
        scannedLocationRaw = segments[segments.length - 2];
        scannedColour = (segments[segments.length - 1] || "").toLowerCase();
      } else if (segments.length === 1) {
        scannedColour = (segments[0] || "").toLowerCase();
      }
    } catch {
      scannedColour = (code || "").toLowerCase().trim();
    }

    const scannedLocationSlug = normalizeLocationSlug(scannedLocationRaw);

    const scannedLabel = [
      scannedLocationRaw || "",
      scannedColour ? scannedColour.toUpperCase() : "",
    ]
      .filter(Boolean)
      .join(" / ");

    if (!scannedColour) {
      setScanError(
        "That code didn’t look like a station. Try another or ask your teacher."
      );
      return;
    }

    if (!expectedColour || scannedColour !== expectedColour) {
      const expectedLabel = expectedColour
        ? expectedColour.toUpperCase()
        : "the correct";
      setScanError(
        `That’s the wrong station colour. You scanned ${
          scannedLabel || "this code"
        }, but your team needs the ${expectedLabel} station.`
      );

      setScannedStationId(null);
      setScannerActive(false);
      setTimeout(() => setScannerActive(true), 100);

      return;
    }

    setScanError(null);
    setScannerActive(false);
    setScannedStationId(assignedStationId);

    socket.emit(
      "station:scan",
      {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        stationId: normAssigned.id,
        locationSlug: scannedLocationSlug,
      },
      (ack) => {
        if (!ack || !ack.ok) {
          setScanError(
            ack?.error || "We couldn't read that station. Try again."
          );

          setScannedStationId(null);
          setScannerActive(false);
          setTimeout(() => setScannerActive(true), 100);
          return;
        }

        setScanError(null);
        setScannerActive(false);
        setScannedStationId(normAssigned.id);
      }
    );

    setStatusMessage(
      `Great! Stay at your ${expectedColour.toUpperCase()} station for the task.`
    );
  };

  const handleScannerCode = (rawValue) => {
    if (!rawValue) return false;
    handleScannedCode(rawValue);
    return false;
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

  const stationInfo = normalizeStationId(assignedStationId);

  const mustScan =
    enforceLocation &&
    assignedStationId &&
    scannedStationId &&
    assignedStationId !== scannedStationId;

  // ─────────────────────────────────────────────
  // Socket listeners for room / task / noise / treats / collab
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!teamId) return;

    const handleRoomState = (state) => {
      if (!state || !teamId) return;
      const myTeam = state.teams?.[teamId];
      if (!myTeam) return;

      if (state.scores && typeof state.scores[teamId] === "number") {
        setScoreTotal(state.scores[teamId]);
      }

      const newStationId = myTeam.currentStationId || myTeam.stationId;
      if (newStationId && newStationId !== lastStationIdRef.current) {
        lastStationIdRef.current = newStationId;

        const norm = normalizeStationId(newStationId);
        setAssignedStationId(norm.id);
        setAssignedColor(norm.color || null);

        setScannedStationId(null);
        setScanError(null);
        setScannerActive(true);

        const colourLabel = norm.color
          ? norm.color.toUpperCase()
          : "your";
        setStatusMessage(
          `New station! Scan your ${colourLabel} station QR code.`
        );
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
      setCurrentTask(payload.task || null);
      setCurrentTaskIndex(
        typeof payload.taskIndex === "number" ? payload.taskIndex : null
      );
      setTasksetTotalTasks(
        typeof payload.totalTasks === "number" ? payload.totalTasks : null
      );

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

      const review = buildAnswerReview(currentTask);
      if (review) setShortAnswerReveal(review);

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
    socket.on("task:scored", handleTaskScored);
    socket.on("noise:update", handleNoiseUpdate);
    socket.on("treat:event", handleTreat);
    socket.on("collab:partner-answer", handleCollabPartner);
    socket.on("collab:reply", handleCollabReply);

    socket.emit("room:request-state", { teamId });

    return () => {
      socket.off("room:state", handleRoomState);
      socket.off("task:assigned", handleTaskAssigned);
      socket.off("task:scored", handleTaskScored);
      socket.off("noise:update", handleNoiseUpdate);
      socket.off("treat:event", handleTreat);
      socket.off("collab:partner-answer", handleCollabPartner);
      socket.off("collab:reply", handleCollabReply);
    };
  }, [teamId, reviewPauseSeconds, currentTask]);

  // ─────────────────────────────────────────────
  // THEME + STYLING HELPERS
  // ─────────────────────────────────────────────
  const themeShell =
    uiTheme === "bold"
      ? {
          bg: "radial-gradient(circle at top, #020617, #020617)",
          cardBg: "rgba(15,23,42,0.96)",
          cardBorder: "1px solid rgba(148,163,184,0.8)",
          text: "#e5e7eb",
          accent: "#f97316",
        }
      : uiTheme === "minimal"
      ? {
          bg: "radial-gradient(circle at top, #e5e7eb, #f9fafb)",
          cardBg: "rgba(248,250,252,0.98)",
          cardBorder: "1px solid rgba(209,213,219,0.9)",
          text: "#111827",
          accent: "#2563eb",
        }
      : {
          bg: "radial-gradient(circle at top, #020617, #0b1120)",
          cardBg: "rgba(15,23,42,0.96)",
          cardBorder: "1px solid rgba(51,65,85,0.9)",
          text: "#e5e7eb",
          accent: "#22c55e",
        };

  const getStationBubbleStyles = (color) => {
    if (!color) {
      return {
        background:
          uiTheme === "minimal"
            ? "rgba(248,250,252,0.96)"
            : "rgba(15,23,42,0.92)",
        border:
          uiTheme === "minimal"
            ? "1px solid rgba(209,213,219,0.9)"
            : "1px solid rgba(51,65,85,0.9)",
        color: themeShell.text,
      };
    }

    const base = {
      marginBottom: 8,
      padding: 12,
      borderRadius: 12,
    };

    if (color === "red") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(127,29,29,0.96))",
        border: "1px solid rgba(252,165,165,0.8)",
        color: "#fee2e2",
      };
    }
    if (color === "blue") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(30,64,175,0.96))",
        border: "1px solid rgba(191,219,254,0.8)",
        color: "#dbeafe",
      };
    }
    if (color === "green") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(22,101,52,0.96))",
        border: "1px solid rgba(187,247,208,0.8)",
        color: "#dcfce7",
      };
    }
    if (color === "yellow") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(133,77,14,0.96))",
        border: "1px solid rgba(254,240,138,0.8)",
        color: "#fef9c3",
      };
    }
    if (color === "purple") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(168,85,247,0.12), rgba(88,28,135,0.96))",
        border: "1px solid rgba(233,213,255,0.8)",
        color: "#f3e8ff",
      };
    }
    if (color === "orange") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(124,45,18,0.96))",
        border: "1px solid rgba(254,215,170,0.8)",
        color: "#ffedd5",
      };
    }
    if (color === "teal") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(45,212,191,0.12), rgba(15,118,110,0.96))",
        border: "1px solid rgba(204,251,241,0.8)",
        color: "#ccfbf1",
      };
    }
    if (color === "pink") {
      return {
        ...base,
        background:
          "linear-gradient(135deg, rgba(244,114,182,0.12), rgba(131,24,67,0.96))",
        border: "1px solid rgba(251,207,232,0.8)",
        color: "#fce7f3",
      };
    }

    return {
      background:
        uiTheme === "minimal"
          ? "rgba(248,250,252,0.96)"
          : "rgba(15,23,42,0.92)",
      border:
        uiTheme === "minimal"
          ? "1px solid rgba(209,213,219,0.9)"
          : "1px solid rgba(51,65,85,0.9)",
      color: themeShell.text,
    };
  };

  const justSubmitted =
    lastTaskResult &&
    typeof lastTaskResult.scoreDelta === "number" &&
    !taskLocked &&
    postSubmitSecondsLeft != null;

  const headerConnectionText = joined
    ? roomCode
      ? `Connected · Room ${roomCode.toUpperCase()}`
      : "Connected"
    : joiningRoom
    ? roomCode
      ? `Joining Room ${roomCode.toUpperCase()}…`
      : "Joining Room…"
    : connected
    ? "Connected to server"
    : "Connecting…";

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <div
      className="student-app-shell"
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: 0,
        fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont',
        color: themeShell.text,
        backgroundImage: themeShell.bg,
        backgroundAttachment: "fixed",
        backgroundSize: "cover",
      }}
    >
      <style>
        {`
        :root {
          color-scheme: dark;
        }

        body {
          margin: 0;
          padding: 0;
        }

        .pill-muted {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 0.75rem;
          border: 1px solid rgba(148,163,184,0.5);
          color: #e5e7eb;
          background: rgba(15,23,42,0.8);
        }

        .pill-location {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 999px;
          padding: 2px 10px;
          font-size: 0.75rem;
          background: rgba(15,23,42,0.8);
          color: #d1fae5;
          border: 1px solid rgba(34,197,94,0.7);
        }

        .pill-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 2px 10px;
          font-size: 0.75rem;
          border: 1px solid rgba(148,163,184,0.5);
          background: rgba(15,23,42,0.9);
        }

        .treat-banner {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          max-width: min(480px, 90vw);
          padding: 10px 14px;
          border-radius: 999px;
          background: radial-gradient(
            circle at top,
            rgba(14,116,144,0.95),
            rgba(8,47,73,0.98)
          );
          color: #f9fafb;
          font-size: 0.85rem;
          box-shadow: 0 18px 40px rgba(15,23,42,0.8);
          text-align: center;
          z-index: 900;
        }

        .toast {
          position: fixed;
          bottom: 68px;
          right: 16px;
          padding: 8px 12px;
          border-radius: 999px;
          background: radial-gradient(
            circle at top,
            rgba(34,197,94,0.95),
            rgba(22,101,52,0.98)
          );
          color: #f0fdf4;
          font-size: 0.8rem;
          font-weight: 600;
          box-shadow: 0 18px 40px rgba(22,163,74,0.8);
          z-index: 900;
        }

        .toast.negative {
          background: radial-gradient(
            circle at top,
            rgba(248,113,113,0.95),
            rgba(127,29,29,0.98)
          );
          color: #fef2f2;
        }

        .noise-strip {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: 8px;
          width: min(480px, 90vw);
        }

        .point-pill {
          position: absolute;
          top: 10px;
          right: 10px;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 0.8rem;
          background: rgba(15,23,42,0.9);
          border: 1px solid rgba(148,163,184,0.7);
          color: #f9fafb;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .point-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }

        .station-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.75rem;
          background: rgba(15,23,42,0.7);
          border: 1px solid rgba(148,163,184,0.6);
        }

        .station-dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          box-shadow: 0 0 0 1px rgba(15,23,42,0.9);
        }

        .scanner-shell {
          margin-bottom: 8px;
          padding: 8px;
          border-radius: 12px;
          background: rgba(15,23,42,0.95);
          border: 1px solid rgba(51,65,85,0.9);
        }

        .scan-error {
          margin-top: 6px;
          font-size: 0.8rem;
          color: #fecaca;
        }

        .correct-answer-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(
            circle at top,
            rgba(15,23,42,0.8),
            rgba(15,23,42,0.98)
          );
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 950;
        }

        .correct-answer-card {
          max-width: 420px;
          width: 90vw;
          background: rgba(15,23,42,0.98);
          border-radius: 16px;
          padding: 16px;
          border: 1px solid rgba(148,163,184,0.7);
          color: #e5e7eb;
        }

        .correct-answer-card h3 {
          margin: 0 0 8px 0;
          font-size: 1rem;
        }

        .correct-answer-card pre {
          margin: 0;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(15,23,42,0.95);
          border: 1px solid rgba(55,65,81,0.9);
          font-size: 0.85rem;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .confetti-layer {
          pointer-events: none;
          position: fixed;
          inset: 0;
          overflow: hidden;
          z-index: 940;
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

        @keyframes confetti-fall {
          0% {
            transform: translateY(-10vh) rotate(0deg);
          }
          100% {
            transform: translateY(110vh) rotate(540deg);
          }
        }

        .confetti-piece {
          animation: confetti-fall 2.2s linear forwards;
        }

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
          text-align: center;
          padding: 12px;
        }
        `}
      </style>

      <main
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "12px 10px 72px",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <section
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
                    style={{
                      background:
                        assignedColor === "red"
                          ? "#ef4444"
                          : assignedColor === "blue"
                          ? "#3b82f6"
                          : assignedColor === "green"
                          ? "#22c55e"
                          : assignedColor === "yellow"
                          ? "#eab308"
                          : assignedColor === "purple"
                          ? "#a855f7"
                          : assignedColor === "orange"
                          ? "#f97316"
                          : assignedColor === "teal"
                          ? "#14b8a6"
                          : assignedColor === "pink"
                          ? "#ec4899"
                          : "#e5e7eb",
                    }}
                  />
                  <span>
                    {stationInfo.label || "Station"}
                  </span>
                </span>
              )}

              <span className="pill-location">
                <span>Location:</span>
                <strong>
                  {roomLocation
                    ? roomLocation.charAt(0).toUpperCase() +
                      roomLocation.slice(1).replace(/-/g, " ")
                    : "Classroom"}
                </strong>
              </span>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 4,
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
                  Bold
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
                  Minimal
                </button>
              </div>

              {joined && (
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  style={{
                    marginTop: 4,
                    borderRadius: 999,
                    padding: "4px 8px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    background: "rgba(15,23,42,0.14)",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Join a different room
                </button>
              )}
            </div>

            <div
              style={{
                fontSize: "0.75rem",
                color: connected ? "#bbf7d0" : "#fecaca",
              }}
            >
              {headerConnectionText}
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
        </section>

        {/* JOIN CARD */}
        {!joined && (
          <main
            style={{
              flex: 1,
              display: "flex",
              alignItems: "flex-start",
            }}
          >
            <div
              className="join-card"
              style={{
                background: themeShell.cardBg,
                border: themeShell.cardBorder,
                color: themeShell.text,
                borderRadius: 16,
                padding: 12,
                width: "100%",
                boxShadow:
                  uiTheme === "minimal"
                    ? "0 10px 30px rgba(15,23,42,0.10)"
                    : "0 18px 40px rgba(15,23,42,0.75)",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: 6,
                  fontSize: "1.1rem",
                }}
              >
                Join a room
              </h2>
              <p
                style={{
                  marginTop: 0,
                  marginBottom: 12,
                  fontSize: "0.85rem",
                  color:
                    uiTheme === "minimal" ? "#4b5563" : "#9ca3af",
                }}
              >
                Enter the code your presenter shows on the board, pick a
                team name, and list your team members.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleJoin();
                }}
              >
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
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      fontSize: "1rem",
                      textTransform: "uppercase",
                    }}
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
                    Team name
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      fontSize: "1rem",
                    }}
                  />
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      marginBottom: 4,
                    }}
                  >
                    Team members (optional)
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {members.map((m, idx) => (
                      <input
                        key={idx}
                        type="text"
                        value={m}
                        onChange={(e) =>
                          setMembers((prev) => {
                            const next = [...prev];
                            next[idx] = e.target.value;
                            return next;
                          })
                        }
                        placeholder={`Member ${idx + 1}`}
                        style={{
                          width: "100%",
                          padding: "4px 6px",
                          borderRadius: 6,
                          border: "1px solid #e5e7eb",
                          fontSize: "0.95rem",
                        }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMembers((prev) => [...prev, ""])}
                    style={{
                      marginTop: 4,
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "none",
                      background: "#e5e7eb",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    + Add member field
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={!canJoin || joiningRoom}
                  style={{
                    marginTop: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "none",
                    background: "#16a34a",
                    color: "#ffffff",
                    fontSize: "0.95rem",
                    cursor:
                      !canJoin || joiningRoom
                        ? "not-allowed"
                        : "pointer",
                    opacity: !canJoin || joiningRoom ? 0.6 : 1,
                    fontWeight: 600,
                  }}
                >
                  {joiningRoom ? "Joining…" : "Ready for action"}
                </button>
              </form>
            </div>
          </main>
        )}

        {/* QR SCANNER */}
        {joined && scannerActive && (
          <section className="scanner-shell">
            <QrScanner
              active={scannerActive}
              onCode={handleScannerCode}
              onError={setScanError}
            />
            {scanError && (
              <div className="scan-error">
                ⚠ {scanError}
              </div>
            )}
          </section>
        )}

        {/* STATUS + STATION CARD */}
        {joined && (
          <section
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              ...getStationBubbleStyles(assignedColor),
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  {mustScan
                    ? "Scan your station to unlock the next task"
                    : currentTask
                    ? `Task ${
                        typeof currentTaskIndex === "number"
                          ? currentTaskIndex + 1
                          : "?"
                      } of ${
                        typeof tasksetTotalTasks === "number"
                          ? tasksetTotalTasks
                          : "?"
                      }`
                    : "Waiting for your teacher’s next task…"}
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    opacity: 0.9,
                  }}
                >
                  {mustScan
                    ? stationInfo.label
                      ? `Hold your device steady and scan the ${stationInfo.label} station QR code.`
                      : "Hold your device steady and scan the station QR code your teacher assigned."
                    : currentTask
                    ? "Read carefully, work with your team, then submit before time runs out."
                    : "Stay at your current station. Your teacher will launch the next activity."}
                </div>
              </div>

              <div className="point-pill">
                <span className="point-dot" />
                <span>
                  {scoreTotal}{" "}
                  <span
                    style={{
                      opacity: 0.8,
                      fontWeight: 400,
                    }}
                  >
                    points
                  </span>
                </span>
              </div>
            </div>

            <div
              style={{
                marginTop: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                fontSize: "0.8rem",
              }}
            >
              <div>
                {timeLimitSeconds && timeLimitSeconds > 0 ? (
                  <span>
                    Time left:{" "}
                    <strong>{formatMs(remainingMs)}</strong>
                  </span>
                ) : currentTask ? (
                  <span>Take the time you need, but stay focused.</span>
                ) : (
                  <span>Timer: waiting for next task.</span>
                )}
              </div>
              {mustScan && (
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontStyle: "italic",
                    opacity: 0.9,
                  }}
                >
                  Scanner is active — aim at the QR code.
                </div>
              )}
            </div>
          </section>
        )}

        {/* TASK CARD */}
        {joined && currentTask && !mustScan && (
          <section
            className="task-card"
            style={{
              marginTop: 4,
              borderRadius: 16,
              position: "relative",
              overflow: "hidden",
              background:
                uiTheme === "minimal"
                  ? "#f9fafb"
                  : "linear-gradient(135deg,#020617,#020617)",
              border:
                uiTheme === "minimal"
                  ? "1px solid #e5e7eb"
                  : "1px solid rgba(30,64,175,0.75)",
              boxShadow:
                uiTheme === "minimal"
                  ? "0 10px 25px rgba(15,23,42,0.15)"
                  : "0 18px 40px rgba(15,23,42,0.98)",
              padding: 12,
            }}
          >
            {taskLocked && (
              <div className="task-locked-overlay">
                <div>
                  <div
                    style={{
                      fontSize: "0.9rem",
                      marginBottom: 4,
                    }}
                  >
                    Task locked for review
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                    }}
                  >
                    {postSubmitSecondsLeft != null
                      ? `Your teacher is reviewing answers. ${
                          postSubmitSecondsLeft > 0
                            ? `About ${postSubmitSecondsLeft}s…`
                            : "Almost done…"
                        }`
                      : "Your teacher is reviewing answers. Watch the board."}
                  </div>
                </div>
              </div>
            )}

            <TaskRunner
              task={currentTask}
              taskIndex={currentTaskIndex}
              totalTasks={tasksetTotalTasks}
              teamId={teamId}
              teamName={teamName}
              roomCode={roomCode}
              mustScan={mustScan}
              enforceLocation={enforceLocation}
              assignedStationId={assignedStationId}
              scannedStationId={scannedStationId}
              currentAnswerDraft={currentAnswerDraft}
              setCurrentAnswerDraft={setCurrentAnswerDraft}
              onSubmitStart={() => {
                setLastTaskResult(null);
                setPointToast(null);
                setShortAnswerReveal(null);
              }}
              onSubmitComplete={() => {}}
            />
          </section>
        )}

        {showCorrectAnswerOverlay && shortAnswerReveal && (
          <div className="correct-answer-overlay">
            <div className="correct-answer-card">
              <h3>{shortAnswerReveal.label}</h3>
              <pre>{shortAnswerReveal.value}</pre>
              <button
                type="button"
                onClick={() => setShowCorrectAnswerOverlay(false)}
                style={{
                  marginTop: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "none",
                  fontSize: "0.9rem",
                  background:
                    "linear-gradient(90deg,#4f46e5,#6366f1,#a855f7)",
                  color: "#f9fafb",
                  cursor: "pointer",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {treatMessage && <div className="treat-banner">{treatMessage}</div>}

        {pointToast && (
          <div className={`toast ${pointToast.positive ? "" : "negative"}`}>
            {pointToast.message}
          </div>
        )}

        {showConfetti && (
          <div className="confetti-layer">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className="confetti-piece"
                style={{
                  left: `${(i / 40) * 100}%`,
                  animationDelay: `${(i % 5) * 0.1}s`,
                }}
              />
            ))}
          </div>
        )}

        <div className="noise-strip">
          <NoiseSensor
            enabled={noiseState.enabled}
            level={noiseState.level}
            threshold={noiseState.threshold}
            brightness={noiseState.brightness}
          />
        </div>
      </main>
    </div>
  );
}
