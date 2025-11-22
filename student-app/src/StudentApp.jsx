// student-app/src/App.jsx
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import { API_BASE_URL } from "./config.js";

// Socket URL – same base as your API (e.g. https://api.curriculate.net)
const SOCKET_URL = API_BASE_URL;

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [joined, setJoined] = useState(false);

  const [assignedColor, setAssignedColor] = useState(null);
  const [stationLabel, setStationLabel] = useState(null);

  const [currentTask, setCurrentTask] = useState(null);
  const [answered, setAnswered] = useState(false);

  // Optional: if you’re using displayKey / station display objects
  const [tasksetDisplays, setTasksetDisplays] = useState([]);
  const [currentDisplay, setCurrentDisplay] = useState(null);

  // ---------------------------------------------------------
  // Connect socket
  // ---------------------------------------------------------
  useEffect(() => {
    const s = io(SOCKET_URL, {
      transports: ["websocket"],
      // if your socket server has CORS credentials enabled, you can flip this to true
      withCredentials: false,
      path: "/socket.io",
    });

    s.on("connect", () => {
      setConnected(true);
    });

    s.on("disconnect", () => {
      setConnected(false);
      setJoined(false);
      setAssignedColor(null);
      setStationLabel(null);
      setCurrentTask(null);
      setAnswered(false);
      setTasksetDisplays([]);
      setCurrentDisplay(null);
    });

    // When host assigns station / color
    s.on("station-assigned", (payload = {}) => {
      // payload:
      // {
      //   color: "RED",
      //   stationLabel: "Red Station Hallway",
      //   displays: [...]
      // }
      setAssignedColor(payload.color || null);
      setStationLabel(payload.stationLabel || null);
      setTasksetDisplays(payload.displays || []);

      if (currentTask && payload.displays) {
        const disp = payload.displays.find(
          (d) => d.key === currentTask.displayKey
        );
        setCurrentDisplay(disp || null);
      }
    });

    // When a new task comes in for this team
    s.on("task-started", (task) => {
      setCurrentTask(task || null);
      setAnswered(false);

      if (task && task.displayKey && tasksetDisplays?.length) {
        const disp = tasksetDisplays.find(
          (d) => d.key === task.displayKey
        );
        setCurrentDisplay(disp || null);
      } else {
        setCurrentDisplay(null);
      }
    });

    // If host ends the task / clears it
    s.on("task-cleared", () => {
      setCurrentTask(null);
      setAnswered(false);
      setCurrentDisplay(null);
    });

    setSocket(s);
    return () => {
      s.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      "joinRoom",
      { roomCode: trimmedRoom, teamName: trimmedTeam, role: "team" },
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
    if (answered) return;

    const payload = {
      roomCode: roomCode.trim().toUpperCase(),
      teamName: teamName.trim(),
      taskId: currentTask._id || currentTask.id,
      answer: answerData,
    };

    socket.emit("submitAnswer", payload, (ack) => {
      if (!ack || !ack.ok) {
        console.error("Submit failed:", ack);
        alert(ack?.error || "Submit failed");
        return;
      }
      setAnswered(true);
    });
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
        padding: "24px 16px 26vh",
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
          marginBottom: 16,
          color: connected ? "#16a34a" : "#b91c1c",
        }}
      >
        {connected ? "Connected" : "Not connected"}
      </p>

      {/* Join form (if not joined yet) */}
      {!joined && (
        <form
          onSubmit={handleJoin}
          style={{
            marginBottom: 24,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              marginBottom: 8,
              fontSize: "0.9rem",
              color: "#111827",
            }}
          >
            {statusLine}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              style={{
                flex: 0.6,
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: "6px 8px",
                fontSize: "0.95rem",
              }}
            />
            <input
              type="text"
              placeholder="Team name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              style={{
                flex: 1,
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: "6px 8px",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={!connected || !roomCode.trim() || !teamName.trim()}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "none",
              background:
                !connected || !roomCode.trim() || !teamName.trim()
                  ? "#9ca3af"
                  : "#2563eb",
              color: "#fff",
              fontWeight: 600,
              cursor:
                !connected || !roomCode.trim() || !teamName.trim()
                  ? "default"
                  : "pointer",
            }}
          >
            Join
          </button>
        </form>
      )}

      {/* Status when joined */}
      {joined && (
        <div
          style={{
            marginBottom: 16,
            padding: 10,
            borderRadius: 10,
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            fontSize: "0.9rem",
            color: "#1e3a8a",
          }}
        >
          {statusLine}
        </div>
      )}

      {/* Task area */}
      <section>
        {joined ? (
          currentTask ? (
            <TaskRunner
              task={currentTask}
              onSubmit={handleSubmit}
              disabled={answered}
              answered={answered}
              stationColor={bandColor}
              currentDisplay={currentDisplay}
            />
          ) : (
            <p
              style={{
                fontSize: "1rem",
                color: "#4b5563",
              }}
            >
              Waiting for task…
            </p>
          )
        ) : (
          <p
            style={{
              fontSize: "0.9rem",
              color: "#6b7280",
            }}
          >
            Once you join a room, tasks from your teacher will appear here.
          </p>
        )}
      </section>

      {/* Fixed coloured band at bottom */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          height: "22vh",
          background: bandColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          textAlign: "center",
          padding: 12,
          transition: "background 0.25s ease-in-out",
        }}
      >
        <div>
          <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>
            Station colour
          </div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>
            {assignedColor || (joined ? "Waiting…" : "Not joined")}
          </div>
          {stationLabel && (
            <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>
              {stationLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Map a color name to a hex – adjust to match your design
function colorToHex(name) {
  if (!name) return "#0f172a";
  const key = String(name).toUpperCase();
  switch (key) {
    case "RED":
      return "#ef4444";
    case "BLUE":
      return "#3b82f6";
    case "GREEN":
      return "#22c55e";
    case "YELLOW":
      return "#eab308";
    case "ORANGE":
      return "#f97316";
    case "PURPLE":
      return "#a855f7";
    case "TEAL":
      return "#14b8a6";
    case "PINK":
      return "#ec4899";
    case "LIME":
      return "#84cc16";
    case "NAVY":
      return "#1d4ed8";
    case "BROWN":
      return "#92400e";
    case "GRAY":
      return "#6b7280";
    default:
      return "#0f172a";
  }
}

export default App;
