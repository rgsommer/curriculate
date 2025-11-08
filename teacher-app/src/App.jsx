import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL;

const socket = io(SOCKET_URL);

export default function App() {
  const [status, setStatus] = useState("Connecting to API…");
  const [roomCode, setRoomCode] = useState("GRADE8A");
  const [prompt, setPrompt] = useState("");
  const [leaderboard, setLeaderboard] = useState({});

  // check API via HTTP (like before)
  useEffect(() => {
    fetch(`${SOCKET_URL}/db-check`)
      .then((r) => r.json())
      .then(() => setStatus("✅ Backend OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  // socket listeners
  useEffect(() => {
    socket.on("connect", () => {
      console.log("teacher connected to socket");
    });

    socket.on("leaderboardUpdate", (scores) => {
      setLeaderboard(scores);
    });

    return () => {
      socket.off("connect");
      socket.off("leaderboardUpdate");
    };
  }, []);

  // actually launch a task
  const handleLaunch = () => {
    if (!prompt.trim()) return;
    socket.emit("teacherLaunchTask", {
      roomCode,
      task: {
        prompt,
        // later: type, choices, timer, etc.
      },
    });
  };

  const handleBonus = () => {
    socket.emit("teacherSpawnBonus", { roomCode, points: 5, durationMs: 8000 });
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui" }}>
      {/* sidebar */}
      <div style={{ width: 220, background: "#18233a", color: "#fff", padding: 16 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Curriculate</h2>
        <p style={{ opacity: 0.6, fontSize: "0.7rem" }}>Teacher</p>
        <p style={{ marginTop: 14, fontSize: "0.7rem" }}>{status}</p>
      </div>

      {/* main content */}
      <div style={{ flex: 1, padding: 20 }}>
        <h1>Live Session</h1>
        <p>Room code students should enter:</p>
        <input
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          style={{ padding: 6, marginBottom: 16, display: "block" }}
        />

        <label>Task / prompt to send:</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ display: "block", width: "100%", minHeight: 80, marginTop: 6, marginBottom: 12 }}
          placeholder="Write the question, instruction, or station task here…"
        />

        <button
          onClick={handleLaunch}
          style={{ background: "#2b6cb0", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
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

        {/* Leaderboard preview */}
        <div style={{ marginTop: 30 }}>
          <h2>Live Leaderboard</h2>
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
