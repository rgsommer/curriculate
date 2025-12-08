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

function normalizeStationId(raw) {
  if (!raw) return { id: null, color: null, label: "" };
  const lower = String(raw).toLowerCase().trim();

  // Case 1: "station-1", "station-2", ...
  let m = /^station-(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < COLOR_NAMES.length) {
      const color = COLOR_NAMES[idx];
      return {
        id: `station-${idx + 1}`,
        color,
        label: `Station-${color[0].toUpperCase()}${color.slice(1)}`,
      };
    }
  }

  // Case 2: "1", "2", ...
  m = /^(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < COLOR_NAMES.length) {
      const color = COLOR_NAMES[idx];
      return {
        id: `station-${idx + 1}`,
        color,
        label: `Station-${color[0].toUpperCase()}${color.slice(1)}`,
      };
    }
  }

  // Case 3: "red", "blue", ...
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

  return { id: raw, color: null, label: raw };
}

// ---------------------------------------------------------------------
// StudentApp Component
// ---------------------------------------------------------------------

export default function StudentApp() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembersText, setTeamMembersText] = useState("");
  const [teamId, setTeamId] = useState(null);
  const [teamSessionId, setTeamSessionId] = useState(null);

  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);

  const [statusMessage, setStatusMessage] = useState(
    "Scan the QR and join the game!"
  );

  const [currentTask, setCurrentTask] = useState(null);
  const [taskIndex, setTaskIndex] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [assignedStationId, setAssignedStationId] = useState(null);
  const [assignedColor, setAssignedColor] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);

  const [roomLocation, setRoomLocation] = useState("Classroom");
  const [enforceLocation, setEnforceLocation] = useState(false);

  const [answerDraft, setAnswerDraft] = useState(null);

  const [sessionComplete, setSessionComplete] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState(0);
  const [noiseEnabled, setNoiseEnabled] = useState(false);

  const [petTreatMessage, setPetTreatMessage] = useState("");
  const petTreatTimeoutRef = useRef(null);

  const [score, setScore] = useState(0);

  const roomLocationFromStateRef = useRef(null);
  const lastNoiseUpdateRef = useRef(0);

  const audioUnlockedRef = useRef(false);
  const joinSoundRef = useRef(null);
  const treatSoundRef = useRef(null);

  // Unlock audio after a user gesture so we can play sounds later
  const unlockAudioForBrowser = () => {
    if (audioUnlockedRef.current) return;
    const tryUnlock = () => {
      audioUnlockedRef.current = true;
      window.removeEventListener("click", tryUnlock);
      window.removeEventListener("touchstart", tryUnlock);
    };
    window.addEventListener("click", tryUnlock, { once: true });
    window.addEventListener("touchstart", tryUnlock, { once: true });
  };

  // ---------------------------------------------------------------
  // Initialize socket.io connection
  // ---------------------------------------------------------------
  useEffect(() => {
    const url = API_BASE_URL || "";
    const s = io(url, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    setSocket(s);

    const handleConnect = () => {
      console.log("SOCKET: Connected", s.id);
      setConnected(true);

      // Try to resume from sessionStorage
      try {
        const stored = sessionStorage.getItem("teamSession");
        if (!stored) return;

        const parsed = JSON.parse(stored);
        if (!parsed.roomCode || !parsed.teamSessionId) return;

        console.log("Attempting resume-team-session with", parsed);
        s.emit(
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

              // 🔑 ensure we show correct “Connected Room …” text
              setStatusMessage(
                `Connected Room ${parsed.roomCode.toUpperCase()}`
              );
            }

            if (typeof ack.roomState?.scores === "object") {
              const numericScore =
                typeof ack.roomState.scores[ack.teamId] === "number"
                  ? ack.roomState.scores[ack.teamId]
                  : 0;
              setScore(numericScore);
            } else {
              setScore(0);
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

    s.on("connect", handleConnect);
    s.on("disconnect", handleDisconnect);

    // Noise-level events from server
    s.on("session:noiseLevel", (payload = {}) => {
      const now = Date.now();
      if (now - lastNoiseUpdateRef.current < 200) return;
      lastNoiseUpdateRef.current = now;

      const level =
        typeof payload.level === "number" && !Number.isNaN(payload.level)
          ? payload.level
          : 0;

      setNoiseLevel(level);
      setNoiseEnabled(!!payload.enabled);
    });

    // Session complete event (e.g., after last task)
    s.on("session:complete", () => {
      setSessionComplete(true);
      setStatusMessage("Session complete! Please wait for your teacher.");
      try {
        sessionStorage.removeItem("teamSession");
      } catch {
        // ignore
      }
    });

    // Session ended via REST / teacher
    s.on("session:ended", () => {
      setSessionComplete(true);
      setStatusMessage("This session has ended. Thanks for playing!");
      try {
        sessionStorage.removeItem("teamSession");
      } catch {
        // ignore
      }
      alert("This session has ended. Talk to your teacher about what’s next.");
    });

    // Treat events
    s.on("teamTreatAssigned", ({ roomCode, teamId, teamName }) => {
      if (!teamId || teamId !== teamSessionId) return;

      console.log("Treat assigned to this team!", { roomCode, teamId });

      if (audioUnlockedRef.current && treatSoundRef.current) {
        treatSoundRef.current.play().catch(() => {});
      }

      setPetTreatMessage(
        `Treat time! Your team ${teamName || ""} just earned a reward!`
      );
      if (petTreatTimeoutRef.current) {
        clearTimeout(petTreatTimeoutRef.current);
      }
      petTreatTimeoutRef.current = setTimeout(() => {
        setPetTreatMessage("");
      }, 8000);
    });

    return () => {
      s.off("connect", handleConnect);
      s.off("disconnect", handleDisconnect);
      s.off("session:noiseLevel");
      s.off("session:complete");
      s.off("session:ended");
      s.off("teamTreatAssigned");
      s.close();
    };
  }, [teamSessionId]);

  useEffect(() => {
    return () => {
      if (petTreatTimeoutRef.current) {
        clearTimeout(petTreatTimeoutRef.current);
      }
    };
  }, []);

  const handleTaskLaunch = (payload) => {
    if (!payload || !payload.task) return;
    console.log("STUDENT: Received task launch:", payload);

    setCurrentTask(payload.task || null);
    setTaskIndex(
      typeof payload.index === "number" ? payload.index : null
    );
    setAnswerDraft(null);

    if (payload.task?.taskType === TASK_TYPES.FLASHCARDS_RACE) {
      setScannerActive(false);
    }
  };

  useEffect(() => {
    if (!socket) return;

    socket.on("task:launch", handleTaskLaunch);

    return () => {
      socket.off("task:launch", handleTaskLaunch);
    };
  }, [socket]);

  const handleScanResult = (decodedText) => {
    if (!decodedText) return;
    console.log("QR scan result:", decodedText);
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

    const members = teamMembersText
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    const filteredMembers =
      members.length > 0
        ? members
        : ["Player 1", "Player 2", "Player 3", "Player 4"];

    setJoiningRoom(true);
    setStatusMessage("Joining room…");

    const timeoutId = setTimeout(() => {
      console.warn(
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
        setTeamId(teamSession);
        setTeamSessionId(teamSession);
        setStatusMessage(`Connected Room ${finalRoom}`);

        try {
          sessionStorage.setItem(
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

        setEnforceLocation(!!ack.roomState?.enforceLocation);
        if (ack.roomState?.locationCode) {
          setRoomLocation(ack.roomState.locationCode);
          roomLocationFromStateRef.current = ack.roomState.locationCode;
        }

        if (ack.assignedStationId) {
          const norm = normalizeStationId(ack.assignedStationId);
          setAssignedStationId(ack.assignedStationId);
          setAssignedColor(norm.color || null);
          setScannedStationId(null);
          setScannerActive(true);
        } else {
          setAssignedStationId(null);
          setAssignedColor(null);
          setScannerActive(false);
        }

        if (typeof ack.totalScore === "number") {
          setScore(ack.totalScore);
        } else if (
          ack.roomState &&
          typeof ack.roomState.scores === "object" &&
          typeof ack.roomState.scores[teamSession] === "number"
        ) {
          setScore(ack.roomState.scores[teamSession]);
        } else {
          setScore(0);
        }
      }
    );
  };

  const handleTaskSubmit = (answerPayload) => {
    if (!socket || !roomCode || !teamId || currentTask == null) return;

    const payload = {
      roomCode: roomCode.toUpperCase(),
      teamId,
      taskIndex,
      answer: answerPayload,
    };

    console.log("STUDENT: Submitting answer:", payload);

    setSubmitting(true);

    socket.emit("student:submitAnswer", payload, (ack) => {
      console.log("STUDENT: Submit ACK:", ack);
      setSubmitting(false);

      if (!ack || ack.ok !== true) {
        alert(ack?.error || "We couldn't submit your answer. Check your connection and tell your teacher.");
        return;
      }

      if (typeof ack.newScore === "number") {
        setScore(ack.newScore);
      }

      setCurrentTask(null);
      setAnswerDraft(null);
      setScannerActive(true);
      setStatusMessage("Answer received! Get ready for your next station.");
    });
  };

  const handleAnswerChange = (partialAnswer) => {
    setAnswerDraft(partialAnswer);
  };

  const handleScanStation = (decodedText) => {
    if (!socket || !joined) return;
    const trimmed = decodedText.trim();
    const norm = normalizeStationId(trimmed);

    setScannedStationId(norm.id);

    socket.emit(
      "station:scan",
      {
        roomCode: roomCode.toUpperCase(),
        teamId: teamId,
        stationId: norm.id,
      },
      (ack) => {
        console.log("station:scan ACK:", ack);
        if (!ack || !ack.ok) {
          alert(
            ack?.error ||
              "Scan failed. Make sure you are scanning the correct station for this task."
          );
          setScannerActive(true);
          return;
        }

        setAssignedStationId(norm.id);
        setAssignedColor(norm.color || null);
        setScannerActive(false);
        setStatusMessage("Station scanned! Wait for your task…");
      }
    );
  };

  const renderJoinScreen = () => {
    return (
      <div className="student-join-screen">
        <h1 className="student-title">Join the Game</h1>
        <p className="student-subtitle">
          Enter your room code and team name to get started.
        </p>

        <div className="join-form">
          <div className="form-group">
            <label>Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="e.g. ABC123"
            />
          </div>

          <div className="form-group">
            <label>Team Name</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. The Innovators"
            />
          </div>

          <div className="form-group">
            <label>Team Members (optional)</label>
            <input
              type="text"
              value={teamMembersText}
              onChange={(e) => setTeamMembersText(e.target.value)}
              placeholder="Comma-separated names"
            />
          </div>

          <button
            className="join-button"
            onClick={handleJoin}
            disabled={joiningRoom || !connected}
          >
            {joiningRoom ? "Joining…" : "Join Room"}
          </button>

          {!connected && (
            <p className="connection-hint">
              Connecting to server… please wait a moment.
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderTaskScreen = () => {
    const normalizedStation = assignedStationId
      ? normalizeStationId(assignedStationId)
      : null;

    const showScanner =
      scannerActive &&
      (!assignedStationId ||
        (normalizedStation && normalizedStation.id !== scannedStationId));

    return (
      <div className="student-task-screen">
        <header className="student-header">
          <div className="room-tag">
            {roomCode
              ? `Connected Room ${roomCode.toUpperCase()}`
              : "Joining Room…"}
          </div>
          <div className="team-tag">
            Team: <strong>{teamName || "Unnamed Team"}</strong>
          </div>
          <div className="score-tag">
            Score: <strong>{score}</strong>
          </div>
        </header>

        {petTreatMessage && (
          <div className="pet-treat-banner">{petTreatMessage}</div>
        )}

        <main className="student-main">
          <div className="left-column">
            {currentTask ? (
              <div className="task-card">
                <TaskRunner
                  task={currentTask}
                  taskTypes={TASK_TYPES}
                  onSubmit={handleTaskSubmit}
                  submitting={submitting}
                  onAnswerChange={handleAnswerChange}
                  answerDraft={answerDraft}
                  disabled={submitting}
                  socket={socket}
                  roomCode={roomCode.toUpperCase()}
                  playerTeam={teamId}
                />
              </div>
            ) : (
              <div className="waiting-card">
                <h2>Waiting for your next task…</h2>
                <p>
                  Stay ready! Your teacher will send a new challenge to your
                  station soon.
                </p>
              </div>
            )}
          </div>

          <div className="right-column">
            <div className="station-info-card">
              <h3>Your Station</h3>
              {assignedStationId ? (
                <>
                  <p>
                    Station:{" "}
                    <strong>
                      {normalizedStation?.label || assignedStationId}
                    </strong>
                  </p>
                  {assignedColor && (
                    <div
                      className="station-colour-pill"
                      style={{ backgroundColor: assignedColor }}
                    />
                  )}
                  {roomLocation && (
                    <p className="station-location">
                      Location: <strong>{roomLocation}</strong>
                    </p>
                  )}
                  {showScanner ? (
                    <p className="scanner-instructions">
                      Scan the QR code at your station to begin.
                    </p>
                  ) : currentTask ? (
                    <p className="scanner-instructions">
                      Complete your task, then wait for the next scan.
                    </p>
                  ) : (
                    <p className="scanner-instructions">
                      Wait for your teacher to send the next task.
                    </p>
                  )}
                </>
              ) : (
                <p className="scanner-instructions">
                  Wait for your teacher to assign you a station.
                </p>
              )}
            </div>

            <div className="scanner-card">
              <h3>Station Scanner</h3>
              {showScanner ? (
                <QrScanner
                  onDecode={handleScanStation}
                  onError={(err) => console.error("QR scanner error:", err)}
                />
              ) : (
                <p>
                  {currentTask
                    ? "You’re at the right station. Complete your task!"
                    : "No scan needed right now."}
                </p>
              )}
            </div>

            <div className="noise-card">
              <h3>Noise Level</h3>
              <NoiseSensor level={noiseLevel} enabled={noiseEnabled} />
            </div>
          </div>
        </main>

        {sessionComplete && (
          <div className="session-complete-banner">
            Session complete! Great work today.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="student-app-root">
      <audio
        ref={joinSoundRef}
        src="/sounds/join.mp3"
        preload="auto"
      />
      <audio
        ref={treatSoundRef}
        src="/sounds/treat.mp3"
        preload="auto"
      />

      {joined ? renderTaskScreen() : renderJoinScreen()}
    </div>
  );
}
