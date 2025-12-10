// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import QrScanner from "./components/QrScanner.jsx";
import NoiseSensor from "./components/NoiseSensor.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import { API_BASE_URL } from "./config.js";

// Build marker so you can confirm the deployed bundle
console.log("STUDENT BUILD MARKER v2025-12-02-A, API_BASE_URL:", API_BASE_URL);

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
      console.log("SOCKET: Connected", socket.id);
      setConnected(true);

      // Try to resume from sessionStorage
      try {
        const stored = sessionStorage.getItem("teamSession");
        if (!stored) return;

        const parsed = JSON.parse(stored);
        if (!parsed.roomCode || !parsed.teamSessionId) return;

        console.log("Attempting resume-team-session with", parsed);
        socket.emit(
          "resume-team-session",
          {
            roomCode: parsed.roomCode.toUpperCase(),
            teamSessionId: parsed.teamSessionId,
          },
          (ack) => {
            console.log("resume-team-session ack:", ack);
            if (!ack?.success) {
              console.warn("Resume failed:", ack?.error);
              sessionStorage.removeItem("teamSession");
              return;
            }

            // Fixed-station / multi-room + location from room state
            setEnforceLocation(!!ack.roomState?.enforceLocation);
            if (ack.roomState?.locationCode) {
              setRoomLocation(ack.roomState.locationCode);
              roomLocationFromStateRef.current =
                ack.roomState.locationCode;
            }

            setJoined(true);
            setRoomCode(parsed.roomCode.toUpperCase());
            setTeamId(ack.teamId);
            setTeamSessionId(parsed.teamSessionId);

            const myTeam = ack.roomState?.teams?.[ack.teamId] || null;

            if (myTeam?.currentStationId) {
              const norm = normalizeStationId(myTeam.currentStationId);
              setAssignedStationId(myTeam.currentStationId);
              setAssignedColor(norm.color || null);
              setScannedStationId(null);
              setScannerActive(true);

              // Seed lastStationId so next room:state doesn't force a fake "new" station
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
            }
          }
        );
      } catch (err) {
        console.warn(
          "Error reading teamSession from sessionStorage:",
          err
        );
      }
    };

    const handleDisconnect = () => {
      console.log("SOCKET: Disconnected");
      setConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    socket.on("connect_error", (err) =>
      console.log("SOCKET: Connect error:", err.message)
    );

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

      const newStationId = myTeam.currentStationId || null;
      if (!newStationId) return;

      const isNewStation = lastStationIdRef.current !== newStationId;
      const norm = normalizeStationId(newStationId);

      // Keep these in sync for UI
      setAssignedStationId(newStationId);
      setAssignedColor(norm.color ? norm.color : null);

      // Only force a re-scan when the station actually CHANGES
      if (isNewStation) {
        lastStationIdRef.current = newStationId;

        setScannedStationId(null);
        setScannerActive(true);

        const colourLabel = norm.color
          ? norm.color.charAt(0).toUpperCase() + norm.color.slice(1)
          : "your";
        setStatusMessage(`Scan your ${colourLabel} station.`);
      }
    };

    // Last-task result for this team (score + correctness)
    const handleTaskSubmission = (submission) => {
      if (!submission || !teamId) return;

      // Ignore other rooms
      if (
        submission.roomCode &&
        roomCode &&
        submission.roomCode.toUpperCase() !==
          roomCode.trim().toUpperCase()
      ) {
        return;
      }

      // Only care about this team
      if (submission.teamId !== teamId) return;

      setLastTaskResult({
        points:
          typeof submission.points === "number" ? submission.points : 0,
        correct: submission.correct,
        answerText: submission.answerText || "",
        submittedAt: submission.submittedAt || Date.now(),
        aiScore: submission.aiScore || null,
      });
    };

    socket.on("room:state", handleRoomState);
    socket.on("roomState", handleRoomState);
    socket.on("taskSubmission", handleTaskSubmission);

    // Task launches from teacher / engine
    socket.on(
      "task:launch",
      ({ index, task, timeLimitSeconds, totalTasks, tasksetSize, taskCount }) => {
        console.log("SOCKET: task:launch", {
          index,
          task,
          timeLimitSeconds,
          totalTasks,
        });

        // Cancel any post-submit countdown from the previous task
        if (postSubmitTimerRef.current) {
          clearInterval(postSubmitTimerRef.current);
          postSubmitTimerRef.current = null;
        }
        setTaskLocked(false);
        setPostSubmitSecondsLeft(null);

        // Reset collaboration state for the new task
        setPartnerAnswer(null);
        setShowPartnerReply(false);

        setCurrentAnswerDraft("");
        setScanError(null);

        // Just set the task – do NOT touch scan state here.
        setCurrentTask(task || null);
        setCurrentTaskIndex(
          typeof index === "number" && index >= 0 ? index : null
        );

        // Try to capture total tasks in the taskset
        const explicitTotal =
          typeof totalTasks === "number" && totalTasks > 0
            ? totalTasks
            : typeof tasksetSize === "number" && tasksetSize > 0
            ? tasksetSize
            : typeof taskCount === "number" && taskCount > 0
            ? taskCount
            : null;

        if (explicitTotal) {
          setTasksetTotalTasks(explicitTotal);
        }

        // Teacher-controlled review pause (if provided on the task)
        if (
          task &&
          typeof task.reviewPauseSeconds === "number" &&
          task.reviewPauseSeconds >= 5 &&
          task.reviewPauseSeconds <= 60
        ) {
          setReviewPauseSeconds(task.reviewPauseSeconds);
        } else {
          setReviewPauseSeconds(15);
        }

        if (sndAlert.current) {
          sndAlert.current.play().catch(() => {});
        }

        if (
          typeof timeLimitSeconds === "number" &&
          timeLimitSeconds > 0
        ) {
          setTimeLimitSeconds(timeLimitSeconds);
        } else {
          setTimeLimitSeconds(null);
          setRemainingMs(0);
        }
      }
    );

    // Session complete from server
    socket.on("session:complete", () => {
      console.log("SOCKET: session:complete");
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setTasksetTotalTasks(null);
      setScannerActive(false);
      setStatusMessage("Session complete! Please wait for your teacher.");
      try {
        sessionStorage.removeItem("teamSession");
      } catch {
        // ignore
      }
    });

    // Session ended via REST / teacher
    socket.on("session-ended", () => {
      console.log("SOCKET: session-ended");
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setTasksetTotalTasks(null);
      setJoined(false);
      setScannerActive(false);
      setAssignedStationId(null);
      setAssignedColor(null);
      setStatusMessage("This session has ended. Thanks for playing!");
      try {
        sessionStorage.removeItem("teamSession");
      } catch {
        // ignore
      }
      alert("This session has ended. Thanks for playing!");
    });

    // Noise state from backend
    socket.on("session:noiseLevel", (payload) => {
      if (!payload) return;
      setNoiseState({
        enabled: !!payload.enabled,
        threshold: payload.threshold ?? 0,
        level: payload.level ?? 0,
        brightness: payload.brightness ?? 1,
      });
    });

    // Random treat assigned to this team
    socket.on("student:treatAssigned", (payload) => {
      console.log("SOCKET: student:treatAssigned", payload);
      setTreatMessage(
        payload?.message || "See your teacher for a treat!"
      );
      if (sndTreat.current) {
        sndTreat.current.play().catch(() => {});
      }
    });

    return () => {
      socket.off("room:state", handleRoomState);
      socket.off("roomState", handleRoomState);
      socket.off("taskSubmission", handleTaskSubmission);
      socket.off("task:launch");
      socket.off("session:complete");
      socket.off("session-ended");
      socket.off("session:noiseLevel");
      socket.off("student:treatAssigned");
    };
  }, [teamId, roomCode]);

  // ─────────────────────────────────────────────
  // Timer effect for task time limits
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!timeLimitSeconds || timeLimitSeconds <= 0) {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setRemainingMs(0);
      return;
    }

    const totalMs = timeLimitSeconds * 1000;
    const start = Date.now();
    setRemainingMs(totalMs);

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    countdownTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = totalMs - elapsed;
      setRemainingMs(remaining > 0 ? remaining : 0);
      if (remaining <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 250);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [timeLimitSeconds]);

  // ─────────────────────────────────────────────
  // Toast for positive-point submissions
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (
      !lastTaskResult ||
      typeof lastTaskResult.points !== "number" ||
      lastTaskResult.points <= 0
    ) {
      return;
    }

    const id = lastTaskResult.submittedAt || Date.now();
    const toast = { id, points: lastTaskResult.points };
    setPointToast(toast);

    const timer = setTimeout(() => {
      setPointToast((current) =>
        current && current.id === id ? null : current
      );
    }, 1800);

    return () => clearTimeout(timer);
  }, [lastTaskResult]);

  // Confetti burst on "perfect score"
  useEffect(() => {
    if (!lastTaskResult) return;

    const { points, correct, aiScore } = lastTaskResult;

    let isPerfect = false;

    // Prefer rich aiScore when available (multi-item, etc.)
    if (
      aiScore &&
      typeof aiScore.totalScore === "number" &&
      typeof aiScore.maxPoints === "number" &&
      aiScore.maxPoints > 0
    ) {
      isPerfect = aiScore.totalScore >= aiScore.maxPoints;
    } else if (correct === true && typeof points === "number" && points > 0) {
      // Fallback: single objective question (full credit or nothing)
      isPerfect = true;
    }

    if (!isPerfect) return;

    setShowConfetti(true);
    const timer = setTimeout(() => setShowConfetti(false), 2000);

    return () => clearTimeout(timer);
  }, [lastTaskResult]);

  // Auto-hide the short-answer correct-answer overlay after 10 seconds
  useEffect(() => {
    if (!shortAnswerReveal) return;
    const timer = setTimeout(() => {
      setShortAnswerReveal(null);
    }, 10000);
    return () => clearTimeout(timer);
  }, [shortAnswerReveal]);

  // Collaboration partner answer listener
  useEffect(() => {
    if (!socket) return;

    const handlePartnerAnswer = (payload) => {
      setPartnerAnswer(payload.partnerAnswer);
      setShowPartnerReply(true);
    };

    socket.on("collab:partner-answer", handlePartnerAnswer);

    return () => {
      socket.off("collab:partner-answer", handlePartnerAnswer);
    };
  }, []);

  // Cleanup for post-submit countdown timer
  useEffect(() => {
    return () => {
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
        postSubmitTimerRef.current = null;
      }
    };
  }, []);

  // ─────────────────────────────────────────────
  // Utility – unlock browser audio
  // ─────────────────────────────────────────────

  const unlockAudioForBrowser = () => {
    if (audioContext) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const newContext = new Ctx();
    newContext
      .resume()
      .then(() => {
        console.log("AudioContext unlocked");
        setAudioContext(newContext);
      })
      .catch((err) => console.warn("AudioContext unlock failed:", err));
  };

  // ─────────────────────────────────────────────
  // Join room (persistent student:join-room)
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

    console.log("STUDENT: Attempting to join room:", {
      finalRoom,
      teamName: teamName.trim(),
      members: filteredMembers,
      socketId: socket.id,
    });

    setJoiningRoom(true);
    setStatusMessage(`Joining Room ${finalRoom}…`);

    // TIMEOUT SAFETY — if no ack in 8 seconds, fail
    const timeoutId = setTimeout(() => {
      console.error(
        "STUDENT: JOIN TIMEOUT — no response from server after 8s"
      );
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
        console.log("STUDENT: ACK FROM SERVER:", ack);

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

        // Persist for resume-team-session
        try {
          sessionStorage.setItem(
            "teamSession",
            JSON.stringify({
              roomCode: finalRoom,
              teamSessionId: teamSession,
            })
          );
          console.log("STUDENT: teamSession persisted to sessionStorage");
        } catch (err) {
          console.warn("Unable to persist teamSession:", err);
        }

        // Fixed-station / multi-room is signaled from the room state
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

          // Seed lastStationId so later room:state updates
          lastStationIdRef.current = myTeam.currentStationId;

          const colourLabel = norm.color
            ? ` ${norm.color.toUpperCase()}`
            : "";

          setStatusMessage(
            `Scan your${colourLabel} station to get started.`
          );
        } else {
          // No station assigned yet – do not enable scanner yet
          lastStationIdRef.current = null;
          setStatusMessage(
            "Waiting for your teacher to assign your station."
          );
          setScannerActive(false);
          setScannedStationId(null);
        }
      }
    );

    console.log("STUDENT: socket.emit('student:join-room') called");
  };

  // ─────────────────────────────────────────────
  // QR Scan handler – checks colour + room
  // ─────────────────────────────────────────────

  const handleScannedCode = (code) => {
    if (!joined || !teamId) {
      setScanError("Join a room first, then scan a station.");
      return;
    }

    if (!assignedStationId) {
      setScanError("Wait until your teacher assigns a station, then scan.");
      return;
    }

    const normAssigned = normalizeStationId(assignedStationId);
    const expectedColour = normAssigned.color;

    // Parse QR payload – expected pattern: ".../<location>/<colour>"
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
      // Non-URL payload → treat entire string as the colour
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

      // Re-arm the scanner so they can try again
      setScannedStationId(null);
      setScannerActive(false);
      setTimeout(() => setScannerActive(true), 100);

      return;
    }

    // ✅ Colour matches – we *ignore* location for now.
    setScanError(null);
    setScannerActive(false);
    setScannedStationId(assignedStationId);

    socket.emit(
      "station:scan",
      {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        stationId: normAssigned.id,
      },
      (ack) => {
        if (!ack || !ack.ok) {
          setScanError(
            ack?.error || "We couldn't read that station. Try again."
          );

          // Reset scanner so the student can try again
          setScannedStationId(null);
          setScannerActive(false);
          setTimeout(() => setScannerActive(true), 100);
          return;
        }

        // Success
        setScanError(null);
        setScannerActive(false);
        setScannedStationId(normAssigned.id);
      }
    );

    setStatusMessage(
      `Great! Stay at your ${expectedColour.toUpperCase()} station for the task.`
    );
  };

  // ─────────────────────────────────────────────
  // Submit answer
  // ─────────────────────────────────────────────

  const handleSubmitAnswer = async (answerPayload) => {
    if (!roomCode || !joined || !currentTask || teamId == null) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      // Send answer to server and wait for ack
      await new Promise((resolve, reject) => {
        socket
          .timeout(8000)
          .emit(
            "student:submitAnswer",
            {
              roomCode: roomCode.trim().toUpperCase(),
              teamId,
              taskIndex:
                typeof currentTaskIndex === "number" &&
                currentTaskIndex >= 0
                  ? currentTaskIndex
                  : null,
              answer: answerPayload,
            },
            (err, ack) => {
              if (err) {
                console.error(
                  "Submit timeout / transport error:",
                  err
                );
                return reject(err);
              }
              if (!ack || !ack.ok) {
                console.error("Submit failed:", ack?.error);
                return reject(
                  new Error(
                    ack?.error ||
                      "Submission failed — please tell your teacher."
                  )
                );
              }
              resolve();
            }
          );
      });

      // Decide whether to show a "correct answer" overlay for SHORT_ANSWER
      if (
        currentTask &&
        currentTask.taskType === TASK_TYPES.SHORT_ANSWER &&
        typeof currentTask.correctAnswer === "string" &&
        currentTask.correctAnswer.trim() !== ""
      ) {
        setShortAnswerReveal({
          prompt: currentTask.prompt || "",
          correctAnswer: currentTask.correctAnswer.trim(),
        });
      } else {
        setShortAnswerReveal(null);
      }

      // Clear timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setTimeLimitSeconds(null);
      setRemainingMs(0);

      // 🔒 Lock the task for review and start a countdown
      const pause =
        typeof reviewPauseSeconds === "number" &&
        reviewPauseSeconds >= 5 &&
        reviewPauseSeconds <= 60
          ? reviewPauseSeconds
          : 15;

      setTaskLocked(true);
      setPostSubmitSecondsLeft(pause);
      setScannerActive(false);
      setStatusMessage(
        "Review your answers. Next round is starting soon…"
      );

      // Clear any existing post-submit timer
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
        postSubmitTimerRef.current = null;
      }

      // Start countdown before returning to scan mode
      postSubmitTimerRef.current = setInterval(() => {
        setPostSubmitSecondsLeft((current) => {
          if (current == null) return null;
          if (current <= 1) {
            clearInterval(postSubmitTimerRef.current);
            postSubmitTimerRef.current = null;

            // ✅ Now hide task and move to next station
            setCurrentTask(null);
            setCurrentTaskIndex(null);
            setScannedStationId(null);
            setScannerActive(true);
            setStatusMessage(
              "Answer submitted! Find your next station colour and scan it."
            );
            setTaskLocked(false);
            return 0;
          }
          return current - 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Submit error:", err);
      alert(
        "We couldn't submit your answer. Check your connection and tell your teacher."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────
  // Derived display values
  // ─────────────────────────────────────────────

  const assignedNorm = normalizeStationId(assignedStationId);
  const scannedNorm = normalizeStationId(scannedStationId);

  const mustScan =
    joined &&
    scannerActive &&
    !!assignedStationId &&
    scannedStationId !== assignedStationId;

  const assignedColour = assignedNorm.color;

  // Normalized display location for prompt
  const displayLocation =
    (roomLocationFromStateRef.current || DEFAULT_LOCATION).toUpperCase();

  let scanPrompt = "";
  if (assignedColour) {
    const colorLabel = assignedColour.toUpperCase();

    if (enforceLocation) {
      scanPrompt = `Scan your ${displayLocation} ${colorLabel} station.`;
    } else {
      scanPrompt = `Scan your ${colorLabel} station.`;
    }
  } else {
    scanPrompt = "Scan your station.";
  }

  // Font scaling for younger grades
  let responseFontSize = "1rem";
  let responseHeadingFontSize = "1rem";
  const gradeRaw =
    currentTask?.gradeLevel ?? currentTask?.meta?.gradeLevel ?? null;
  const parsedGrade =
    gradeRaw != null ? parseInt(String(gradeRaw), 10) : null;

  if (!Number.isNaN(parsedGrade) && parsedGrade > 0) {
    if (parsedGrade <= 4) {
      responseFontSize = "1.15rem";
      responseHeadingFontSize = "1.2rem";
    } else if (parsedGrade <= 6) {
      responseFontSize = "1.08rem";
      responseHeadingFontSize = "1.15rem";
    } else if (parsedGrade <= 8) {
      responseFontSize = "1.02rem";
      responseHeadingFontSize = "1.1rem";
    } else {
      responseFontSize = "0.98rem";
      responseHeadingFontSize = "1.05rem";
    }
  }

  // JEOPARDY / Draw-Mime / FlashcardsRace flags for header + styling
  const isJeopardy =
  currentTask?.taskType === TASK_TYPES.JEOPARDY;

  const isDrawMime =
    currentTask?.taskType === TASK_TYPES.DRAW ||
    currentTask?.taskType === TASK_TYPES.MIME ||
    currentTask?.taskType === TASK_TYPES.DRAW_MIME;

  const isFlashcardsRace =
    currentTask?.taskType === TASK_TYPES.FLASHCARDS_RACE;

  const isLiveDebate =
    currentTask?.taskType === TASK_TYPES.LIVE_DEBATE;

  // Theme-enriched task object
  const themedTask =
    currentTask && uiTheme ? { ...currentTask, uiTheme } : currentTask;

  // Base card styles + background variant for Draw/Mime & Race rounds
  const baseTaskCardStyle = {
    marginBottom: 12,
    padding: 14,
    borderRadius: 20,
    boxShadow: "0 10px 25px rgba(15,23,42,0.18)",
    border: "1px solid rgba(129,140,248,0.35)",
  };

  const taskCardBackground = isFlashcardsRace
    ? "linear-gradient(135deg, #0f172a 0%, #1d4ed8 35%, #a855f7 70%, #f97316 100%)"
    : isDrawMime
    ? "linear-gradient(135deg, #fef3c7 0%, #fee2e2 40%, #f9fafb 100%)"
    : isLiveDebate
    ? "linear-gradient(135deg, #0f172a 0%, #fb7185 35%, #f97316 70%, #facc15 100%)"
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

  const progressPercent =
    currentTaskNumber && totalTasks
      ? Math.min((currentTaskNumber / totalTasks) * 100, 100)
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
          : themeShell.pageBg,
        color: themeShell.text,
        opacity: noiseState.enabled ? noiseState.brightness : 1,
        transition: "opacity 120ms ease-out",
      }}
    >
      {/* Scoped styles for task presentation & submission */}
      <style>{`
        .task-card input[type="text"],
        .task-card input[type="number"],
        .task-card input[type="email"],
        .task-card textarea {
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #d1d5db;
          font-size: 1rem;
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

        .task-card button:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 3px 8px rgba(15,23,42,0.3);
        }

        .task-card button:disabled {
          opacity: 0.6;
          cursor: default;
          box-shadow: none;
        }

        /* FLASHCARDS — realistic card appearance */
        .flashcard-container {
          perspective: 1200px;
          width: 100%;
          display: flex;
          justify-content: center;
          margin: 12px 0;
        }

        .flashcard {
          width: 90%;
          max-width: 360px;
          min-height: 200px;
          padding: 20px;
          border-radius: 16px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          transform-style: preserve-3d;
          transition: transform 0.6s ease;
          cursor: pointer;
          backface-visibility: hidden;
          font-size: 1.1rem;
          line-height: 1.5;
        }

        /* When flipped */
        .flashcard.flipped {
          transform: rotateY(180deg);
        }

        .flashcard-back {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          transform: rotateY(180deg);
          padding: 20px;
          border-radius: 16px;
          background: #f1f5f9;
          border: 1px solid #d1d5db;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
        }

        /* ───────────────────────────────────────────
           CONFETTI LAYER FOR PERFECT SCORE
        ─────────────────────────────────────────── */
        .confetti-layer {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 9999;
        }

        .confetti-piece {
          position: absolute;
          top: -10%;
          width: 8px;
          height: 14px;
          border-radius: 2px;
          opacity: 0;
          animation-name: confettiFall;
          animation-duration: 1.6s;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }

        .confetti-piece:nth-child(4n) {
          background-color: #f97316;
        }
        .confetti-piece:nth-child(4n + 1) {
          background-color: #22c55e;
        }
        .confetti-piece:nth-child(4n + 2) {
          background-color: #3b82f6;
        }
        .confetti-piece:nth-child(4n + 3) {
          background-color: #e11d48;
        }

        @keyframes confettiFall {
          0% {
            transform: translate3d(0, 0, 0) rotateZ(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translate3d(0, 120vh, 0) rotateZ(360deg);
            opacity: 0;
          }
        }
      `}</style>

      {/* Hidden audio elements for task / scan sounds */}
      <audio
        ref={sndAlert}
        src="/sounds/scan-alert.mp3"
        preload="auto"
        style={{ display: "none" }}
      />
      <audio
        ref={sndTreat}
        src="/sounds/treat-chime.mp3"
        preload="auto"
        style={{ display: "none" }}
      />

      {/* Main content column */}
      <div
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 520,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <header style={{ marginBottom: 4 }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.4rem",
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
            {joined
              ? roomCode
                ? `Connected · Room ${roomCode.toUpperCase()}`
                : "Connected"
              : joiningRoom
              ? roomCode
                ? `Joining Room ${roomCode.toUpperCase()}…`
                : "Joining Room…"
              : connected
              ? "Connected to server"
              : "Connecting…"}
          </p>
        </header>

        {treatMessage && (
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              background: "#f97316",
              color: "#ffffff",
              fontSize: "0.9rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div>
              <strong style={{ marginRight: 4 }}>Treat time!</strong>
              {treatMessage}
            </div>
            <button
              type="button"
              onClick={() => setTreatMessage(null)}
              style={{
                border: "none",
                background: "rgba(255,255,255,0.15)",
                color: "#ffffff",
                padding: "4px 8px",
                borderRadius: 999,
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        )}

        {/* JOIN PANEL */}
        {!joined && (
          <section
            style={{
              maxWidth: 480,
              width: "100%",
              background: themeShell.cardBg,
              borderRadius: 16,
              padding: 16,
              border: themeShell.cardBorder,
              color: themeShell.text,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "1.1rem",
              }}
            >
              Join your room
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <label style={{ fontSize: "0.85rem" }}>
                Room code
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) =>
                    setRoomCode(e.target.value.toUpperCase())
                  }
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    marginTop: 2,
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    fontSize: "1rem",
                  }}
                />
              </label>

              <label style={{ fontSize: "0.85rem" }}>
                Team name
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    marginTop: 2,
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    fontSize: "1rem",
                  }}
                />
              </label>

              <div>
                <div
                  style={{
                    fontSize: "0.85rem",
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
                  onClick={() =>
                    setMembers((prev) => [...prev, ""])
                  }
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

              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: 4,
                  }}
                >
                  Choose a theme
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {["modern", "bold", "minimal"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setUiTheme(t)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid #d1d5db",
                        background:
                          uiTheme === t ? "#0ea5e9" : "#f9fafb",
                        color:
                          uiTheme === t ? "#ffffff" : "#111827",
                        fontSize: "0.8rem",
                        cursor: "pointer",
                      }}
                    >
                      {t === "modern"
                        ? "Theme 1"
                        : t === "bold"
                        ? "Bold"
                        : "Minimal"}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleJoin}
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "none",
                  background: "#16a34a",
                  color: "#ffffff",
                  fontSize: "0.95rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Ready for action
              </button>
            </div>
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
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 4,
                fontSize: "1rem",
              }}
            >
              Team {teamName || "?"}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "inherit",
              }}
            >
              {statusMessage}
            </p>

            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid #e5e7eb",
                fontSize: "0.85rem",
              }}
            >
              <div>
                <strong>Current station: </strong>
                {assignedNorm.label}
              </div>
              {/* Score info */}
              <div style={{ marginTop: 2 }}>
                <strong>Score:</strong> {scoreTotal} pts
              </div>
              {lastTaskResult && (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: "0.8rem",
                    color:
                      lastTaskResult.correct === true
                        ? "#166534"
                        : lastTaskResult.correct === false
                        ? "#b91c1c"
                        : "#111827",
                  }}
                >
                  Last task:{" "}
                  {lastTaskResult.correct === true
                    ? "✅ Correct"
                    : lastTaskResult.correct === false
                    ? "❌ Incorrect"
                    : "☑️ Submitted"}
                  {typeof lastTaskResult.points === "number" && (
                    <> ({lastTaskResult.points} pts)</>
                  )}
                </div>
              )}
              {mustScan ? (
                <div
                  style={{
                    marginTop: 2,
                    fontWeight: 600,
                    color: "inherit",
                  }}
                >
                  {scanPrompt}
                </div>
              ) : scannedStationId ? (
                <div
                  style={{
                    marginTop: 2,
                    color: "inherit",
                  }}
                >
                  Station confirmed ({scannedNorm.label}).
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 2,
                    color: "inherit",
                  }}
                >
                  Waiting for a task…
                </div>
              )}
              {scanError && (
                <div
                  style={{
                    marginTop: 6,
                    color: "#b91c1c",
                    fontSize: "0.8rem",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {scanError}
                </div>
              )}
            </div>
          </section>
        )}

        {/* SCANNER CARD */}
        {joined && scannerActive && (
          <section
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              background: assignedColor
                ? `var(--${assignedColor}-500, #eff6ff)`
                : "#eff6ff",
              boxShadow:
                scannerActive && assignedColor
                  ? "0 0 0 0 rgba(255,255,255,0.9)"
                  : "0 1px 3px rgba(15,23,42,0.12)",
              transition:
                "background 0.2s ease, box-shadow 0.2s ease",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "1rem",
                color: assignedColor ? "#ffffff" : "#111827",
              }}
            >
              {scanPrompt}
            </h2>
            <QrScanner
              active={scannerActive}
              onCode={handleScannedCode}
              onError={setScanError}
            />
          </section>
        )}

        {/* TASK CARD */}
        {joined && currentTask && !mustScan && (
          <section
            className="task-card"
            style={{
              ...baseTaskCardStyle,
              background: taskCardBackground,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 6,
                fontSize: responseHeadingFontSize,
                letterSpacing: 0.2,
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <span>
                      Task{" "}
                      <strong>{currentTaskNumber}</strong>
                      {totalTasks ? ` of ${totalTasks}` : ""}
                    </span>
                    {progressPercent != null && (
                      <span>{Math.round(progressPercent)}%</span>
                    )}
                  </div>
                  {progressPercent != null && (
                    <div
                      style={{
                        width: "100%",
                        height: 6,
                        borderRadius: 999,
                        background: "rgba(209,213,219,0.8)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progressPercent}%`,
                          height: "100%",
                          borderRadius: 999,
                          background:
                            "linear-gradient(90deg,#22c55e,#0ea5e9)",
                          transition: "width 0.25s ease-out",
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {isFlashcardsRace
              ? "Flashcards Race!"
              : isJeopardy
              ? "Jeopardy clue"
              : isDrawMime
              ? "Draw or Mime!"
              : isLiveDebate
              ? "Live debate!"
              : "Your task"}

            </h2>

            {currentTask?.taskType === TASK_TYPES.JEOPARDY &&
              currentTask?.jeopardyConfig?.boardTitle && (
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "0.88rem",
                    color: "#4b5563",
                  }}
                >
                  Game:{" "}
                  <strong>
                    {currentTask.jeopardyConfig.boardTitle}
                  </strong>
                </p>
              )}

            {timeLimitSeconds && timeLimitSeconds > 0 && (
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: "0.9rem",
                  color: "#b91c1c",
                  fontWeight: 500,
                }}
              >
                Time left: {formatRemainingMs(remainingMs)}
              </p>
            )}

            <div
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: 16,
                background: "rgba(255,255,255,0.98)",
                border: "1px solid rgba(209,213,219,0.9)",
                fontSize: responseFontSize,
                lineHeight: 1.5,
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
                // Collaboration wiring
                partnerAnswer={partnerAnswer}
                showPartnerReply={showPartnerReply}
                onPartnerReply={(replyText) => {
                  if (
                    !roomCode ||
                    !joined ||
                    !currentTask ||
                    teamId == null
                  )
                    return;

                  socket.emit("collab:reply", {
                    roomCode: roomCode.trim().toUpperCase(),
                    teamId,
                    taskIndex:
                      typeof currentTaskIndex === "number" &&
                      currentTaskIndex >= 0
                        ? currentTaskIndex
                        : null,
                    reply: replyText,
                  });
                }}
              />
            </div>

            {taskLocked && (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 12,
                  background: "rgba(45,212,191,0.08)",
                  border: "1px solid rgba(45,212,191,0.5)",
                  fontSize: "0.85rem",
                  color: "#0f172a",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  Round summary
                </div>

                {lastTaskResult?.aiScore &&
                typeof lastTaskResult.aiScore.totalItems === "number" ? (
                  <div>
                    You answered{" "}
                    <strong>
                      {lastTaskResult.aiScore.correctCount ??
                        lastTaskResult.aiScore.totalScore ??
                        "?"}
                    </strong>{" "}
                    of{" "}
                    <strong>
                      {lastTaskResult.aiScore.totalItems}
                    </strong>{" "}
                    correctly
                    {typeof lastTaskResult.points === "number" && (
                      <>
                        {" "}
                        and earned{" "}
                        <strong>{lastTaskResult.points} pts</strong>.
                      </>
                    )}
                  </div>
                ) : lastTaskResult ? (
                  <div>
                    Your answer was{" "}
                    {lastTaskResult.correct === true
                      ? "correct 🎉"
                      : lastTaskResult.correct === false
                      ? "not correct"
                      : "submitted"}
                    {typeof lastTaskResult.points === "number" && (
                      <> ({lastTaskResult.points} pts)</>
                    )}
                    .
                  </div>
                ) : (
                  <div>Waiting for scoring from your teacher…</div>
                )}

                {postSubmitSecondsLeft != null &&
                  postSubmitSecondsLeft > 0 && (
                    <div style={{ marginTop: 4 }}>
                      Next round starting in{" "}
                      <strong>{postSubmitSecondsLeft}</strong>{" "}
                      second
                      {postSubmitSecondsLeft === 1 ? "" : "s"}
                      …
                    </div>
                  )}
              </div>
            )}
          </section>
        )}
      </div>

      {joined && (
        <NoiseSensor
          active={noiseState.enabled}
          roomCode={roomCode}
          socket={socket}
          ignoreNoise={!!currentTask?.ignoreNoise}
        />
      )}

      {showConfetti && (
        <div className="confetti-layer">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${(i * 2.5) % 100}%`,
                animationDelay: `${(i % 10) * 0.08}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Correct-answer overlay for SHORT_ANSWER tasks */}
      {shortAnswerReveal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,23,42,0.55)",
            zIndex: 130,
          }}
          onClick={() => setShortAnswerReveal(null)}
        >
          <div
            style={{
              maxWidth: 420,
              width: "90%",
              background: "#f9fafb",
              borderRadius: 18,
              padding: 16,
              boxShadow: "0 18px 45px rgba(15,23,42,0.5)",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "1rem",
                marginBottom: 6,
                color: "#0f172a",
              }}
            >
              Correct answer
            </div>

            {shortAnswerReveal.prompt && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#6b7280",
                  marginBottom: 8,
                }}
              >
                {shortAnswerReveal.prompt}
              </div>
            )}

            <div
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                marginBottom: 12,
                color: "#111827",
              }}
            >
              {shortAnswerReveal.correctAnswer}
            </div>

            <button
              type="button"
              onClick={() => setShortAnswerReveal(null)}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "6px 16px",
                fontSize: "0.85rem",
                fontWeight: 600,
                background: "#22c55e",
                color: "#f9fafb",
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* +points toast */}
      {pointToast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "20vh",
            transform: "translateX(-50%)",
            padding: "8px 16px",
            borderRadius: 999,
            background: "rgba(22,163,74,0.96)",
            color: "#f9fafb",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
            zIndex: 120,
          }}
        >
          +{pointToast.points} points!
        </div>
      )}

      {/* Persistent colour band at the bottom */}
      <div
        style={{
          marginTop: 16,
          width: "100%",
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
