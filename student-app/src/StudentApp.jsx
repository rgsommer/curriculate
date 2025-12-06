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

function getStationColorStyles(colorName) {
  if (!colorName) {
    return { background: "#fef9c3", color: "#111" };
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
  const isLight = ["yellow", "orange", "pink", "teal"].includes(colorName);
  return { background: bg, color: isLight ? "#111" : "#fff" };
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

  // Whether to enforce location as well as colour (fixed-station / multi-room scavenger hunts)
  const [enforceLocation, setEnforceLocation] = useState(false);

  // Teacher-defined location (e.g. "Classroom", "Hallway") + stable ref
  const [roomLocation, setRoomLocation] = useState(DEFAULT_LOCATION);
  const roomLocationFromStateRef = useRef(DEFAULT_LOCATION);

  // Audio
  const [audioContext, setAudioContext] = useState(null);
  const sndAlert = useRef(null);
  const sndTreat = useRef(null);

  // Timer ref
  const countdownTimerRef = useRef(null);

  // ─────────────────────────────────────────────
  // Socket connect / disconnect + auto-resume
  // ─────────────────────────────────────────────

  useEffect(() => {
    const handleConnect = () => {
      console.log("SOCKET: Connected", socket.id);
      setConnected(true);

      // Try to resume from localStorage
      try {
        const stored = localStorage.getItem("teamSession");
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
              localStorage.removeItem("teamSession");
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

              // 🔑 Seed lastStationId so next room:state doesn't force a fake "new" station
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
          "Error reading teamSession from localStorage:",
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
  // Server event listeners – room, tasks, noise, treats
  // ─────────────────────────────────────────────

  useEffect(() => {
    // Room / station state updates
    const handleRoomState = (state) => {
      if (!state || !teamId) return;
      const myTeam = state.teams?.[teamId];
      if (!myTeam) return;

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
        // Location is basically only for multi-room hunts; ignore it here.
        setStatusMessage(`Scan your ${colourLabel} station.`);
      } else {
        // Same station → leave scannerActive / scannedStationId alone
      }
    };

    socket.on("room:state", handleRoomState);
    socket.on("roomState", handleRoomState);

    // Task launches from teacher / engine
    socket.on("task:launch", ({ index, task, timeLimitSeconds }) => {
      console.log("SOCKET: task:launch", { index, task, timeLimitSeconds });

      // Just set the task – do NOT touch scan state here.
      setCurrentTask(task || null);
      setCurrentTaskIndex(
        typeof index === "number" && index >= 0 ? index : null
      );
      setCurrentAnswerDraft("");
      setScanError(null);

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
    });

    // Session complete from server
    socket.on("session:complete", () => {
      console.log("SOCKET: session:complete");
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setScannerActive(false);
      setStatusMessage("Session complete! Please wait for your teacher.");
      try {
        localStorage.removeItem("teamSession");
      } catch {
        // ignore
      }
    });

    // Session ended via REST / teacher
    socket.on("session-ended", () => {
      console.log("SOCKET: session-ended");
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setJoined(false);
      setScannerActive(false);
      setAssignedStationId(null);
      setAssignedColor(null);
      setStatusMessage("This session has ended. Thanks for playing!");
      try {
        localStorage.removeItem("teamSession");
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
      socket.off("task:launch");
      socket.off("session:complete");
      socket.off("session-ended");
      socket.off("session:noiseLevel");
      socket.off("student:treatAssigned");
    };
  }, [teamId]);

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
          localStorage.setItem(
            "teamSession",
            JSON.stringify({
              roomCode: finalRoom,
              teamSessionId: teamSession,
            })
          );
          console.log("STUDENT: teamSession persisted");
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
          // don’t force a fake “new station” rescan
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

      // 🔹 Re-arm the scanner so they can try again
      setScannedStationId(null);
      setScannerActive(true);

      return;
    }

    // ✅ Colour matches – we *ignore* location for now.
    setScanError(null);
    setScannerActive(false);
    setScannedStationId(assignedStationId);

    socket.emit("station:scan", {
      roomCode: roomCode.trim().toUpperCase(),
      teamId,
      stationId: normAssigned.id,
      // For future multi-room scavenger hunts we still send a normalized slug
      locationSlug: scannedLocationSlug || null,
      rawCode: code,
    });

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
      await new Promise((resolve, reject) => {
        socket
          .timeout(8000)
          .emit(
            "student:submitAnswer",
            {
              roomCode: roomCode.trim().toUpperCase(),
              teamId,
              taskIndex:
                typeof currentTaskIndex === "number"
                  ? currentTaskIndex
                  : undefined,
              answer: answerPayload,
            },
            (err, ack) => {
              if (err) {
                console.warn("Submit timeout/error:", err);
                reject(err);
                return;
              }
              if (!ack || !ack.ok) {
                console.warn("Submit not OK:", ack);
                reject(
                  new Error(ack?.error || "Submit failed")
                );
                return;
              }
              resolve();
            }
          );
      });

      // Clear timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setTimeLimitSeconds(null);
      setRemainingMs(0);

      // After submission, hide task and force a rescan
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setScannedStationId(null);
      setScannerActive(true);
      setStatusMessage(
        "Answer submitted! Find your next station colour and scan it."
      );
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
    scannerActive && // only nag when the camera is actually on
    !!assignedStationId &&
    scannedStationId !== assignedStationId;

  const assignedColour = assignedNorm.color;

  // Normalized display location for prompt (use roomState.locationCode when available)
  const displayLocation =
    (roomLocationFromStateRef.current || DEFAULT_LOCATION).toUpperCase();

  // Build the scan prompt:
  // - If multi-room / fixed-station (enforceLocation === true):
  //     "Scan your HALLWAY RED station."
  // - Otherwise:
  //     "Scan your RED station."
  let scanPrompt = "";

  if (assignedColour) {
    const colorLabel = assignedColour.toUpperCase();

    if (enforceLocation) {
      scanPrompt = `Scan your ${displayLocation} ${colorLabel} station.`;
    } else {
      scanPrompt = `Scan your ${colorLabel} station.`;
    }
  } else {
    // Safety fallback (rare): colour not known yet
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

  // Theme-enriched task object
  const themedTask =
    currentTask && uiTheme
      ? { ...currentTask, uiTheme }
      : currentTask;

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
        background: themeShell.pageBg,
        color: themeShell.text,
        opacity: noiseState.enabled ? noiseState.brightness : 1,
        transition: "opacity 120ms ease-out",
      }}
    >
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
                      color: uiTheme === t ? "#ffffff" : "#111827",
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

        {joined && currentTask && !mustScan && (
          <section
            style={{
              marginBottom: 12,
              padding: 14,
              borderRadius: 20,
              background:
                "linear-gradient(135deg, #eef2ff 0%, #eff6ff 40%, #f9fafb 100%)",
              boxShadow: "0 10px 25px rgba(15,23,42,0.18)",
              border: "1px solid rgba(129,140,248,0.35)",
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
              {currentTask?.taskType === TASK_TYPES.JEOPARDY
                ? "Jeopardy clue"
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
                task={themedTask}
                taskTypes={TASK_TYPES}
                onSubmit={handleSubmitAnswer}
                submitting={submitting}
                onAnswerChange={setCurrentAnswerDraft}
                answerDraft={currentAnswerDraft}
              />
            </div>
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
