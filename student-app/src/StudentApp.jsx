// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import { API_BASE_URL } from "./config.js";

// Simple UUID v4 generator (no external lib needed)
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3 | 0x8;
    return v.toString(16);
  });
}

// Shared socket instance for this app
const socket = io(API_BASE_URL, {
  withCredentials: true,
  // Important: keep the connection alive across reloads
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

console.log("API_BASE_URL (student) =", API_BASE_URL);

/* -----------------------------------------------------------
   Station colour helpers – numeric ids (station-1, station-2…)
----------------------------------------------------------- */

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
    const colourIdx = COLOR_NAMES.indexOf(m[1]) + 1;
    return {
      id: `station-${colourIdx}`,
      color: m[1],
      label: `Station-${m[1][0].toUpperCase()}${m[1].slice(1)}`,
    };
  }

  // Default fallback
  return { id: s, color: null, label: s.toUpperCase() };
}

function StudentApp() {
  console.log("STUDENTAPP COMPONENT RENDERED — VERSION 2025");
  
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState(["", "", ""]);
  const [teamId, setTeamId] = useState(null);
  const [teamSessionId, setTeamSessionId] = useState(null);
  const [assignedStationId, setAssignedStationId] = useState(null);
  const [assignedLocation, setAssignedLocation] = useState("any");
  const [assignedColor, setAssignedColor] = useState(null);
  const [currentTask, setCurrentTask] = useState(null);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const timerInterval = useRef(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentAnswerDraft, setCurrentAnswerDraft] = useState("");
  const [answerStatus, setAnswerStatus] = useState(null);
  const [noiseState, setNoiseState] = useState({
    enabled: false,
    threshold: 0,
    level: 0,
    brightness: 1,
  });
  const [lightningPrompt, setLightningPrompt] = useState("");
  const [lightningTimer, setLightningTimer] = useState(0);
  const [responseFontSize, setResponseFontSize] = useState("1rem");
  const [leaderboard, setLeaderboard] = useState(null);
  const [audioContext, setAudioContext] = useState(null);

  // Persistent team identity
  const persistedTeamId = localStorage.getItem("curriculate_teamId");
  const persistedRoomCode = localStorage.getItem("curriculate_roomCode");
  const [teamId, setTeamId] = useState(persistedTeamId || null);

  // DEBUG: Log all socket events
  useEffect(() => {
    const logEvent = (event) => {
      console.log(`SOCKET EVENT → ${event}`);
    };

    socket.on("connect", () => console.log("SOCKET: Connected"));
    socket.on("disconnect", () => console.log("SOCKET: Disconnected"));
    socket.on("connect_error", (err) => console.log("SOCKET: Connect error:", err.message));
    socket.on("station-assigned", (data) => console.log("SOCKET: station-assigned", data));
    socket.on("task", (task) => console.log("SOCKET: task received", task));
    socket.on("team-update", (data) => console.log("SOCKET: team-update", data));

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("station-assigned");
      socket.off("task");
      socket.off("team-update");
    };
  }, []);

  useEffect(() => {
    // Generate persistent teamId the first time they join
    if (!teamId && joined && roomCode) {
      const newId = generateUUID();
      setTeamId(newId);
      localStorage.setItem("curriculate_teamId", newId);
      localStorage.setItem("curriculate_roomCode", roomCode);
    }

    socket.on("connect", () => {
      setConnected(true);
      console.log("Socket connected");
      // Try to resume if we have a teamId and room
      if (teamId && roomCode) {
        socket.emit("resume-session", {
          roomCode: roomCode.toUpperCase(),
          teamId,
        });
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
      console.log("Socket disconnected");
    });

    // Teacher ended the session → wipe local data
    socket.on("session-ended", () => {
      localStorage.removeItem("curriculate_teamId");
      localStorage.removeItem("curriculate_roomCode");
      setTeamId(null);
      setJoined(false);
      setAssignedStation(null);
      setCurrentTask(null);
      alert("This session has ended. Thanks for playing!");
    });

    socket.on("session-resume-failed", () => {
      // Handle if resume fails (e.g., session ended)
      alert("Couldn't resume — please re-join the room.");
      localStorage.removeItem("curriculate_teamId");
      localStorage.removeItem("curriculate_roomCode");
      setTeamId(null);
    });

    socket.on("station-assigned", (data) => {
      console.log("Station assigned:", data);
      const { stationId, color, location = "any" } = data;
      const { label } = normalizeStationId(stationId);
      setAssignedStation({ id: stationId, color, label });
      setAssignedColor(color ? `var(--${color}-500)` : null);
      setAssignedLocation(location);

      if (location !== "any") {
        alert(`Go to: ${location.toUpperCase()}!`);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("session-ended");
      socket.off("session-resume-failed");
      socket.off("station-assigned");
    };
  }, [teamId, roomCode, joined]);

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

  console.log("STUDENT: Attempting to join room:", finalRoom);
  console.log("STUDENT: Team name:", teamName.trim());
  console.log("STUDENT: Persisted teamId:", teamId || "(none)");
  console.log("STUDENT: Socket ID:", socket.id);
  console.log("STUDENT: Socket connected:", socket.connected);

  setJoiningRoom(true);
  setStatusMessage(`Joining Room ${finalRoom}…`);

  // TIMEOUT SAFETY — if no ack in 8 seconds, fail
  const timeout = setTimeout(() => {
    console.error("STUDENT: JOIN TIMEOUT — no response from server after 8s");
    setJoiningRoom(false);
    setStatusMessage("Join failed — timeout");
    alert("Join timed out. Is the teacher in the room?");
  }, 8000);

  socket.emit(
    "join-room",
    {
      roomCode: finalRoom,
      name: teamName.trim(),
      teamId: teamId || undefined,
    },
    (ack) => {
      clearTimeout(timeout); // cancel timeout

      console.log("STUDENT: Received ack from server:", ack);

      if (!ack) {
        console.error("STUDENT: Ack is null/undefined");
        setJoiningRoom(false);
        setStatusMessage("Join failed");
        alert("Server didn't respond properly.");
        return;
      }

      if (!ack.ok) {
        console.error("STUDENT: Join rejected:", ack.error || "Unknown error");
        setJoiningRoom(false);
        setStatusMessage(`Join failed: ${ack.error || "Error"}`);
        alert(ack.error || "Unable to join room.");
        return;
      }

      console.log("STUDENT: JOIN SUCCESSFUL!");
      console.log("STUDENT: Assigned teamId:", ack.teamId);
      console.log("STUDENT: Station:", ack.stationId);
      console.log("STUDENT: Color:", ack.color);
      console.log("STUDENT: Location:", ack.location);

      setRoomCode(finalRoom);
      setJoined(true);
      setJoiningRoom(false);
      setTeamId(ack.teamId || socket.id);

      // Persist
      try {
        localStorage.setItem(
          "teamSession",
          JSON.stringify({
            roomCode: finalRoom,
            teamSessionId: ack.teamId || socket.id,
          })
        );
        console.log("STUDENT: Session persisted to localStorage");
      } catch (err) {
        console.warn("STUDENT: Failed to persist session:", err);
      }

      // Show station
      if (ack.stationId) {
        const norm = normalizeStationId(ack.stationId);
        const colourLabel = norm.color ? norm.color.toUpperCase() : "";
        const locLabel = (ack.location || "any") !== "any" 
          ? ack.location.toUpperCase() 
          : "Classroom";

        setStatusMessage(`Scan a ${locLabel} ${colourLabel} station.`);
        console.log(`STUDENT: Now waiting for scan: ${locLabel} ${colourLabel}`);
      }
    }
  );

  // Debug: confirm emit actually went out
  console.log("STUDENT: socket.emit('join-room') called");
};

  const unlockAudioForBrowser = () => {
    if (audioContext) return;
    const newContext = new (window.AudioContext || window.webkitAudioContext)();
    newContext.resume().then(() => {
      console.log("AudioContext unlocked");
      setAudioContext(newContext);
    }).catch(err => console.warn("AudioContext unlock failed:", err));
  };

  const handleMemberChange = (idx, val) => {
    setMembers((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const addMemberField = () => {
    setMembers((prev) => [...prev, ""]);
  };

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

    console.log("[Student] Ready click", {
      finalRoom,
      realMembersCount: filteredMembers.length,
      socketConnected: connected,
    });

    setJoiningRoom(true);
    setStatusMessage(`Joining Room ${finalRoom}…`);

    socket.emit(
      "join-room",
      {
        roomCode: finalRoom,
        name: teamName.trim(),
        teamId: teamId,
      },
      (ack) => {
        console.log("[Student] join-room ack:", ack);
        if (!ack || !ack.ok) {
          setJoiningRoom(false);
          alert(ack?.error || "Unable to join room.");
          return;
        }

        setRoomCode(finalRoom);
        setJoined(true);
        setJoiningRoom(false);
        setTeamId(ack.teamId || socket.id);

        // NEW: persist session so we can resume later
        const sessionIdToStore = ack.teamId || socket.id;
        try {
          localStorage.setItem(
            "teamSession",
            JSON.stringify({
              roomCode: finalRoom,
              teamSessionId: sessionIdToStore,
            })
          );
        } catch (err) {
          console.warn("Unable to persist teamSession:", err);
        }

        const teams = ack.roomState?.teams || {};
        const team = teams[ack.teamId] || null;
        const locLabel = (
          ack.roomState?.locationCode ||
          locationCode ||
          DEFAULT_LOCATION
        ).toUpperCase();

        if (team?.currentStationId) {
          setAssignedStationId(team.currentStationId);
          const norm = normalizeStationId(team.currentStationId);
          const colourLabel = norm.color ? norm.color.toUpperCase() : "";
          if (colourLabel) {
            setStatusMessage(`Scan a ${locLabel} ${colourLabel} station.`);
          } else {
            setStatusMessage(`Scan a ${locLabel} station.`);
          }
        } else {
          setStatusMessage(`Scan a ${locLabel} station.`);
        }
      }
    );
  };

  // onCode handler: returns true to stop camera, false to keep scanning
  // For a scan to be correct, BOTH location and colour must match.
  const handleScannedCode = (value) => {
    try {
      if (!assignedStationId) {
        setScanError(
          "No station has been assigned yet. Please wait for your teacher."
        );
        return false;
      }

      // Normalise slashes first so we can handle backslash QR text
      let raw = (value || "").trim().replace(/\\/g, "/");

      let segments = [];

      // Try parse as full URL first
      try {
        const url = new URL(raw);
        segments = url.pathname
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
      } catch {
        // Not a valid URL; treat as path-like string
        segments = raw.split("/").map((s) => s.trim()).filter(Boolean);
      }

      if (segments.length < 2) {
        setScanError(
          `Unrecognized station code: "${raw}". Ask your teacher which QR to use.`
        );
        return false;
      }

      // Keep ProperCase for location (e.g. "Classroom"), lowercase for colour
      const location = segments[segments.length - 2];
      const colour = segments[segments.length - 1].toLowerCase();

      const assignedNorm = normalizeStationId(assignedStationId);
      const assignedColour = assignedNorm.color; // "red", "blue", etc.
      //const assignedLocation = locationCode || DEFAULT_LOCATION;

      if (!assignedColour) {
        setScanError(
          `The assigned station colour could not be determined. Please tell your teacher.`
        );
        return false;
      }

      if (location !== assignedLocation || colour !== assignedColour) {
        const scannedLabel = `${location}/${colour}`;
        const correctLabel = `${assignedLocation}/${assignedColour}`;

        setScanError(
          `This is the wrong station.\n\nYou scanned: ${scannedLabel}.\n\nCorrect: ${correctLabel}.\n\nPlease go to the correct station and try again.`
        );
        return false; // wrong station → keep scanning
      }

      // ✅ Correct location + colour for the currently assigned station
      setScannedStationId(assignedStationId);
      setScanError(null);

      const nonEmptyMembers = members.map((m) => m.trim()).filter(Boolean);
      if (nonEmptyMembers.length > 0) {
        setStatusMessage(`Team members: ${nonEmptyMembers.join(", ")}`);
      } else {
        setStatusMessage("Station confirmed.");
      }

      if (roomCode) {
        socket.emit("station:scan", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          stationId: assignedNorm.id || assignedStationId,
        });
      }

      return true; // correct station → stop camera
    } catch (err) {
      console.error("Error handling scanned QR", err);
      setScanError(
        "Something went wrong reading that code. Please tell your teacher."
      );
      return false;
    }
  };

  const handleSubmitAnswer = async (answerPayload) => {
    if (!roomCode || !joined || !currentTask) return;
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
              taskIndex,
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
                reject(new Error(ack?.error || "Submit failed"));
                return;
              }
              resolve();
            }
          );
      });

            if (timeoutTimerRef.current) {
        clearInterval(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      setTimeLimitSeconds(null);
      setRemainingMs(null);
      timeoutSubmittedRef.current = false;

      // After a submission, hide the task and force a rescan for the next colour.
      setCurrentTask(null);
      setScannedStationId(null);
      setStatusMessage(
        "Answer submitted! Find your next station colour and scan it."
      );

    } catch (err) {
      alert(
        "We couldn't submit your answer. Check your connection and tell your teacher."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const assignedNorm = normalizeStationId(assignedStationId);
  const scannedNorm = normalizeStationId(scannedStationId);
  const assignedColor = assignedNorm.color;

  const mustScan =
    joined && !!assignedStationId && scannedStationId !== assignedStationId;

  // Shared scan prompt string (used in text section + above scanner)
  const locLabel = (locationCode || DEFAULT_LOCATION).toUpperCase();
  const colourLabel = assignedNorm.color
    ? ` ${assignedNorm.color.toUpperCase()}`
    : "";
  const scanPrompt = `Scan a ${locLabel}${colourLabel} station.`;

  // ---------------- Font scaling for younger grades ----------------
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
        backgroundColor: "#ffffff",
        color: "#111827",
        opacity: noiseState.enabled ? noiseState.brightness : 1,
        transition: "opacity 120ms ease-out",
      }}
    >
      {/* Hidden audio element for task / scan sounds */}
      <audio
        ref={sndAlert}
        src="/sounds/scan-alert.mp3"
        preload="auto"
        style={{ display: "none" }}
      />

      {/* Hidden audio element for random-treat sound */}
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
              }}
            >
              Got it
            </button>
          </div>
        )}

        {!joined && (
          <section
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              background: "#eff6ff",
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
                        handleMemberChange(idx, e.target.value)
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
                  onClick={addMemberField}
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
              background: "#fef9c3",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: "1rem" }}>
              Team {teamName || "?"}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "#4b5563",
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
                <div style={{ color: "#b91c1c", marginTop: 2 }}>
                  {scanPrompt}
                </div>
              ) : scannedStationId ? (
                <div style={{ color: "#059669", marginTop: 2 }}>
                  Station confirmed ({scannedNorm.label}). Wait for the task.
                </div>
              ) : (
                <div style={{ color: "#6b7280", marginTop: 2 }}>
                  Waiting for a task…
                </div>
              )}
              {scanError && (
                <div
                  style={{
                    marginTop: 6,
                    color: "#b91c1c",
                    fontSize: "0.8rem",
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
              background: assignedColor ? assignedColor : "#eff6ff",
              animation:
                scannerActive && assignedColor
                  ? "stationPulse 1.6s infinite"
                  : "none",
              boxShadow:
                scannerActive && assignedColor
                  ? "0 0 0 0 rgba(255,255,255,0.9)"
                  : "0 1px 3px rgba(15,23,42,0.12)",
              transition: "background 0.2s ease, box-shadow 0.2s ease",
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
                  <strong>{currentTask.jeopardyConfig.boardTitle}</strong>
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

            {/* Inner bubble that holds the actual response UI */}
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
                task={currentTask}
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

      {/* Persistent colour band at the bottom (about half the screen) */}
      <div
        style={{
          marginTop: 16,
          width: "100%",
          height: "50vh",
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          backgroundColor: assignedColor ? assignedColor : "#e5e7eb",
          boxShadow: "0 -4px 12px rgba(15,23,42,0.25)",
        }}
      />
    </div>
  );
}
