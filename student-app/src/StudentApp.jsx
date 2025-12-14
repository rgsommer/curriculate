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
console.log("STUDENT BUILD MARKER v2025-12-12-AI, API_BASE_URL:", API_BASE_URL);

// ---------------------------------------------------------------------
// Station colour helpers – numeric ids (station-1, station-2…)
// ---------------------------------------------------------------------
const COLOR_NAMES = COLORS;

// For now, LiveSession-launched tasks are assumed to use "Classroom"
const DEFAULT_LOCATION = "Classroom";

const DEFAULT_POST_SUBMIT_SECONDS = 15;

function getReadableTextColor(bg) {
  // Simple safe default: white for your station palette
  // If you ever add very light colors, we can switch to dynamic contrast.
  return "#fff";
}

function formatScanLabel({ isMultiRoom, locationLabel, color }) {
  if (!color) return "Scan station QR code";

  const colorUpper = color.toUpperCase();
  const locationUpper = locationLabel ? locationLabel.toUpperCase() : '';

  if (isMultiRoom && locationUpper) {
    return `Scan QR Code at ${locationUpper} ${colorUpper}`;
  }

  return `Scan QR Code at ${colorUpper}`;
}

export default function StudentApp() {
  const socket = useRef(null);
  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState("");
  const [joined, setJoined] = useState(false);
  const [assignedColor, setAssignedColor] = useState(null);
  const [assignedStation, setAssignedStation] = useState(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [currentTask, setCurrentTask] = useState(null);
  const [treatMessage, setTreatMessage] = useState(null);
  const [pointToast, setPointToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [noiseState, setNoiseState] = useState({ enabled: false, level: 0, threshold: 0, brightness: 0 });
  const [scanError, setScanError] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  useEffect(() => {
    socket.current = io(API_BASE_URL, { withCredentials: true });

    socket.current.on('room-update', (data) => {
      setRoomState(data);
      const storedTeamId = localStorage.getItem(`teamId_${data.roomCode}`);
      if (storedTeamId && data.teams[storedTeamId]) {
        setTeamId(storedTeamId);
        setAssignedColor(data.teams[storedTeamId].color);
        setAssignedStation(data.teams[storedTeamId].station);
      }
    });

    socket.current.on('new-task', (task) => {
      setCurrentTask(task);
    });

    socket.current.on('submission-result', (data) => {
      setSubmissionFeedback({
        message: data.message || (data.correct ? "Correct!" : "Not quite"),
        positive: data.correct,
        points: data.points,
      });
    });

    return () => socket.current.disconnect();
  }, []);

  const startOverlayTimer = (duration = DEFAULT_POST_SUBMIT_SECONDS) => {
    setOverlayTimer(duration);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          setCurrentTask(null); // Clear task to auto-advance
          setShowQrScanner(true); // Re-show scanner for next task
          setAssignedStation(null); // Reset for new station
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const joinTeam = () => {
    socket.current.emit('join-team', { roomCode, teamName, members });
    setJoined(true);
  };

  const processQrScan = (result) => {
    socket.current.emit('assign-station', { teamId, stationId: result });
    setShowQrScanner(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>

      {/* Join Room UI */}
      {!joined && (
        <div style={{ padding: 32, maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ fontSize: "2.2rem", marginBottom: 32 }}>Join Room</h1>
          <input placeholder="Room Code" value={roomCode} onChange={e => setRoomCode(e.target.value)} style={{ width: "100%", padding: 14, marginBottom: 16, borderRadius: 12, border: "1px solid #cbd5e1" }} />
          <input placeholder="Team Name" value={teamName} onChange={e => setTeamName(e.target.value)} style={{ width: "100%", padding: 14, marginBottom: 16, borderRadius: 12, border: "1px solid #cbd5e1" }} />
          <input placeholder="Members (optional)" value={members} onChange={e => setMembers(e.target.value)} style={{ width: "100%", padding: 14, marginBottom: 32, borderRadius: 12, border: "1px solid #cbd5e1" }} />
          <button onClick={joinTeam} style={{ width: "100%", padding: 18, background: "#22c55e", color: "#fff", border: "none", borderRadius: 99, fontSize: "1.3rem", fontWeight: 700 }}>
            Join Room
          </button>
        </div>
      )}

      {/* Scanner with Color */}
      {showQrScanner && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: "1.5rem", fontWeight: 900, marginBottom: 20 }}>
            Go to the <span style={{ color: assignedColor ? `var(--${assignedColor}-500)` : "#000" }}>
              {assignedColor || "your assigned"}
            </span> station to scan
          </p>
          <div style={{
            backgroundColor: assignedColor ? `var(--${assignedColor}-500, #e5e7eb)` : "#e5e7eb",
            borderRadius: 20,
            padding: 24,
            display: "inline-block",
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
          }}>
            <QrScanner active={true} onCode={processQrScan} />
          </div>
        </div>
      )}

      {/* Post-Submission Overlay */}
      {submissionFeedback && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.9)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          zIndex: 1000,
          textAlign: "center",
          padding: 20,
        }}>
          <div style={{ fontSize: "3rem", fontWeight: 900, marginBottom: 24 }}>
            {submissionFeedback.message}
          </div>
          {submissionFeedback.points != null && (
            <div style={{ fontSize: "2rem", marginBottom: 40 }}>
              +{submissionFeedback.points} points!
            </div>
          )}
          <div style={{ fontSize: "1.6rem" }}>
            Next task in {overlayTimer}s...
          </div>
        </div>
      )}

      {/* Current Task */}
      {currentTask && !submissionFeedback && (
        <TaskRunner
          task={currentTask}
          onSubmit={(response) => {
            socket.current.emit("submit-task", { roomCode, teamId, response });
            setSubmissionFeedback({ message: "Submitted!", positive: true, points: null });
            startOverlayTimer();
          }}
        />
      )}

      {/* Waiting State */}
      {!currentTask && !submissionFeedback && !showQrScanner && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <h2 style={{ fontSize: "2.2rem" }}>Waiting for your next task…</h2>
          <p style={{ fontSize: "1.5rem", color: "#64748b" }}>Get ready to Curriculate!</p>
        </div>
      )}

      {/* Footer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "18vh", backgroundColor: assignedColor ? `var(--${assignedColor}-500, #e5e7eb)` : "#e5e7eb", borderTopLeftRadius: 32, borderTopRightRadius: 32, boxShadow: "0 -4px 12px rgba(15,23,42,0.25)" }} />
    </div>
  );
}

export default StudentApp;