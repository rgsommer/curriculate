// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL } from "./config";

// Student app talks straight to the same origin as REST
const SOCKET_URL = API_BASE_URL;

// simple local id for this device in this tab
function makePlayerId() {
  return "p-" + Math.random().toString(36).slice(2, 9);
}

function colorToHex(name) {
  if (!name) return "#111827";
  const n = name.toLowerCase();
  if (n.includes("red")) return "#ef4444";
  if (n.includes("blue")) return "#3b82f6";
  if (n.includes("green")) return "#22c55e";
  if (n.includes("yellow")) return "#eab308";
  if (n.includes("orange")) return "#f97316";
  if (n.includes("purple")) return "#a855f7";
  if (n.includes("pink")) return "#ec4899";
  if (n.includes("teal")) return "#14b8a6";
  if (n.includes("brown")) return "#92400e";
  if (n.includes("grey") || n.includes("gray")) return "#6b7280";
  return "#0f172a";
}

export default function StudentApp() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);

  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");

  const [assignedColor, setAssignedColor] = useState(null);
  const [stationLabel, setStationLabel] = useState(null);

  const [currentTask, setCurrentTask] = useState(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(null);
  const [tasksetDisplays, setTasksetDisplays] = useState([]);
  const [currentDisplay, setCurrentDisplay] = useState(null);

  const [answered, setAnswered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const playerIdRef = useRef(makePlayerId());

  // ---------------------------------------------------------
  // Socket setup
  // ---------------------------------------------------------
  useEffect(() => {
    const s = io(SOCKET_URL, {
      transports: ["websocket"],
      withCredentials: true,
    });

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => {
      setConnected(false);
      setJoined(false);
      setCurrentTask(null);
      setCurrentDisplay(null);
    });

    // Teacher starts / sends tasks
    s.on("task:launch", ({ index, task, timeLimitSeconds }) => {
      setCurrentTaskIndex(index);
      setCurrentTask(task || null);
      setAnswered(false);
      setSubmitting(false);

      if (task && task.displayKey && tasksetDisplays?.length) {
        const disp = tasksetDisplays.find((d) => d.key === task.displayKey);
        setCurrentDisplay(disp || null);
      } else {
        setCurrentDisplay(null);
      }
    });

    // Session complete
    s.on("session:complete", () => {
      setCurrentTask(null);
      setCurrentDisplay(null);
    });

    // Server confirms it recorded our submission
    s.on("task:received", () => {
      setSubmitting(false);
      setAnswered(true);
    });

    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [tasksetDisplays]);

  // ---------------------------------------------------------
  // Join
  // ---------------------------------------------------------
  function handleJoin(e) {
    e.preventDefault();
    if (!socket || !connected) return;
    if (!roomCode.trim() || !teamName.trim()) return;

    const trimmedRoom = roomCode.trim().toUpperCase();
    const trimmedTeam = teamName.trim();

    socket.emit(
      "join-room",
      { roomCode: trimmedRoom, teamName: trimmedTeam },
      (ack) => {
        if (ack && ack.ok) {
          setJoined(true);

          if (ack.color) setAssignedColor(ack.color);
          if (ack.stationLabel) setStationLabel(ack.stationLabel);
          if (ack.displays) setTasksetDisplays(ack.displays);

          if (currentTask && ack.displays) {
            const disp = ack.displays.find(
              (d) => d.key === currentTask.displayKey
            );
            setCurrentDisplay(disp || null);
          }
        } else {
          alert(ack?.error || "Failed to join room. Check code.");
        }
      }
    );
  }

  // ---------------------------------------------------------
  // Submit task answer
  // ---------------------------------------------------------
  function handleSubmit(answerData) {
    if (!socket || !joined || !currentTask) return;
    if (answered || submitting) return;

    const trimmedRoom = roomCode.trim().toUpperCase();
    const trimmedTeam = teamName.trim();

    // match backend's teamId derivation used in join-room handler
    const teamId =
      "team-" + trimmedTeam.trim().replace(/\s+/g, "-").toLowerCase();

    const payload = {
      roomCode: trimmedRoom,
      teamId,
      teamName: trimmedTeam,
      playerId: playerIdRef.current,
      taskIndex: currentTaskIndex ?? 0,
      answer: answerData,
    };

    setSubmitting(true);
    socket.emit("task:submit", payload);
    // we'll flip to answered when "task:received" comes back
  }

  // ---------------------------------------------------------
  // Derived UI bits
  // ---------------------------------------------------------
  const bandColor = assignedColor
    ? colorToHex(assignedColor)
    : joined
    ? "#0f172a"
    : "#111827";

  const statusLine = !connected
    ? "Connecting to game server…"
    : !joined
    ? "Enter the room code and your team name to join."
    : assignedColor
    ? `Joined as ${teamName || "your team"} at ${
        stationLabel || assignedColor
      } station.`
    : `Joined as ${teamName || "your team"}. Waiting for station…`;

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------
  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        padding: "24px 16px 26vh", // bottom padding so content never hides under the band
        boxSizing: "border-box",
        fontFamily: "system-ui",
        minHeight: "100dvh",
        overflowY: "auto",
        background: "#ffffff",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Curriculate</h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "0.85rem",
            color: "#4b5563",
          }}
        >
          Student station
        </p>
      </header>

      {/* Connection status */}
      <p
        style={{
          fontSize: "0.9rem",
          marginBottom: 4,
          color: connected ? "#16a34a" : "#b91c1c",
        }}
      >
        {connected ? "Connected" : "Not connected"}
      </p>
      {joined && (
        <p
          style={{
            fontSize: "0.8rem",
            marginTop: 0,
            marginBottom: 16,
            color: "#4b5563",
          }}
        >
          Room: {roomCode.toUpperCase() || "—"}
        </p>
      )}

      {/* Join form */}
      {!joined && (
        <form
          onSubmit={handleJoin}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="room"
              style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}
            >
              Room code
            </label>
            <input
              id="room"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: "1rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="team"
              style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}
            >
              Team name
            </label>
            <input
              id="team"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: "1rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={!connected || !roomCode.trim() || !teamName.trim()}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 999,
              border: "none",
              fontSize: "1rem",
              fontWeight: 600,
              background: connected ? "#0f172a" : "#6b7280",
              color: "#f9fafb",
            }}
          >
            Join room
          </button>
        </form>
      )}

      {/* Status line */}
      <p
        style={{
          fontSize: "0.9rem",
          marginBottom: 16,
          color: "#374151",
        }}
      >
        {statusLine}
      </p>

      {/* Task area */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          minHeight: 160,
        }}
      >
        {!currentTask && (
          <p style={{ fontSize: "0.95rem", color: "#6b7280" }}>
            {joined
              ? "Waiting for your next task…"
              : "Join a room to begin receiving tasks."}
          </p>
        )}

        {currentTask && (
          <>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: "1.1rem",
              }}
            >
              {currentTask.title || "Task"}
            </h2>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: "0.95rem",
                whiteSpace: "pre-wrap",
              }}
            >
              {currentTask.prompt}
            </p>

            {/* For now, treat everything as a free-text answer;
                your earlier specialized controls can drop back in here */}
            <textarea
              disabled={answered || submitting}
              rows={4}
              style={{
                width: "100%",
                fontSize: "0.95rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                marginBottom: 12,
                resize: "vertical",
              }}
              placeholder={answered ? "Answer submitted." : "Type your answer…"}
              onChange={() => {}}
            />

            <button
              type="button"
              disabled={answered || submitting}
              onClick={() => handleSubmit("submitted via simple textarea")}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 999,
                border: "none",
                fontSize: "1rem",
                fontWeight: 600,
                background: answered ? "#16a34a" : "#0f172a",
                color: "#f9fafb",
                opacity: answered || submitting ? 0.7 : 1,
              }}
            >
              {answered
                ? "Answer received"
                : submitting
                ? "Sending…"
                : "Submit answer"}
            </button>
          </>
        )}
      </section>

      {/* Fixed bottom colour band */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          height: "22vh",
          background: bandColor,
          color: "#f9fafb",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: "8px 12px 18px",
        }}
      >
        <div style={{ fontSize: "0.8rem", opacity: 0.85, marginBottom: 4 }}>
          API {connected ? "OK" : "offline"}
          {joined && roomCode
            ? ` • Room: ${roomCode.trim().toUpperCase()}`
            : ""}
        </div>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>
          {teamName || "Your team"}
        </div>
        <div style={{ fontSize: "0.9rem" }}>
          Current station:{" "}
          <span style={{ fontWeight: 600 }}>
            {assignedColor ? stationLabel || assignedColor : "Not assigned yet"}
          </span>
        </div>
      </div>
    </div>
  );
}
