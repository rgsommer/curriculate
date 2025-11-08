import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL;
const socket = io(SOCKET_URL);

export default function LiveOrApp() {
  const [status, setStatus] = useState("Checking backend…");
  const [roomCode, setRoomCode] = useState("GRADE8A");
  const [prompt, setPrompt] = useState("");
  const [leaderboard, setLeaderboard] = useState({});

  useEffect(() => {
    fetch(`${SOCKET_URL}/db-check`)
      .then((r) => r.json())
      .then(() => setStatus("✅ Backend A-OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  useEffect(() => {
    socket.on("leaderboardUpdate", (scores) => {
      setLeaderboard(scores);
    });
    return () => {
      socket.off("leaderboardUpdate");
    };
  }, []);

  const handleLaunch = () => {
    if (!prompt.trim()) return;
    socket.emit("teacherLaunchTask", {
      roomCode,
      task: { prompt },
    });
  };

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1>Curriculate — Teacher</h1>
      <p>{status}</p>

      <label>Room code</label>
      <input
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
        style={{ display: "block", marginBottom: 12 }}
      />

      <label>Task to send</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        style={{ display: "block", width: "100%", minHeight: 70, marginBottom: 12 }}
      />

      <button
        onClick={handleLaunch}
        style={{ background: "#2563eb", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
      >
        Launch
      </button>

      <h2 style={{ marginTop: 24 }}>Leaderboard</h2>
      {Object.entries(leaderboard).length === 0 ? (
        <p>No scores yet.</p>
      ) : (
        Object.entries(leaderboard)
          .sort((a, b) => b[1] - a[1])
          .map(([name, score], i) => (
            <p key={name}>
              {i + 1}. {name} — {score} pts
            </p>
          ))
      )}
    </div>
  );
}
