import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL;
const socket = io(SOCKET_URL);

export default function App() {
  const [status, setStatus] = useState("Checking backend…");
  const [roomCode, setRoomCode] = useState("GRADE8A");
  const [prompt, setPrompt] = useState("");
  const [leaderboard, setLeaderboard] = useState({});

  // HTTP check
  useEffect(() => {
    fetch(`${SOCKET_URL}/db-check`)
      .then((r) => r.json())
      .then(() => setStatus("✅ Backend OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  // socket listeners
  useEffect(() => {
    socket.on("connect", () => {
      console.log("teacher socket connected");
    });

    socket.on("leaderboardUpdate", (scores) => {
      setLeaderboard(scores);
    });

    return () => {
      socket.off("connect");
      socket.off("leaderboardUpdate");
    };
  }, []);

  const handleLaunch = () => {
    if (!prompt.trim()) return;
    socket.emit("teacherLaunchTask", {
      roomCode,
      task: {
        prompt,
      },
    });
    // optionally clear:
    // setPrompt("");
  };

  const handleBonus = () => {
    socket.emit("teacherSpawnBonus", {
      roomCode,
      points: 5,
      durationMs: 8000,
    });
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui" }}>
      <div style={{ width: 220, background: "#18233a", color: "#fff", padding: 16 }}>
        <h2>Curriculate</h2>
        <p style={{ fontSize: "0.75rem", opacity: 0.6 }}>Teacher</p>
        <p style={{ fontSize: "0.7rem", marginTop: 12 }}>{status}</p>
      </div>

      <div style={{ flex: 1, padding: 20 }}>
        <h1>Live Session</h1>

        <label>Room code</label>
        <input
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          style={{ display: "block", marginBottom: 12, padding: 6 }}
        />

        <label>Task / prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask a question or tell them the station task…"
          style={{ display: "block", width: "100%", minHeight: 80, marginBottom: 12 }}
        />

        <button
          onClick={handleLaunch}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            padding: "8px 14px",
            borderRadius: 6,
          }}
        >
          Launch
        </button>

        <button
          onClick={handleBonus}
          style={{
            background: "#f97316",
            color: "#fff",
            border: "none",
            padding: "8px 14px",
            borderRadius: 6,
            marginLeft: 10,
          }}
        >
          Trigger Bonus
        </button>

        <div style={{ marginTop: 30 }}>
          <h2>Leaderboard</h2>
          <div style={{ background: "#f8fafc", padding: 10, borderRadius: 8 }}>
            {Object.entries(leaderboard).length === 0 && <p>No scores yet.</p>}
            {Object.entries(leaderboard)
              .sort((a, b) => b[1] - a[1])
              .map(([name, score], idx) => (
                <p key={name}>
                  {idx + 1}. {name} — {score} pts
                </p>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
