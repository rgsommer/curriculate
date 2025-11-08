// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

// one shared socket for this app
const SOCKET_URL = import.meta.env.VITE_API_URL;
const socket = io(SOCKET_URL);

export default function LiveSession() {
  const [status, setStatus] = useState("Checking backend…");
  const [roomCode, setRoomCode] = useState("GRADE8A");
  const [prompt, setPrompt] = useState("");
  const [leaderboard, setLeaderboard] = useState({});
  const [students, setStudents] = useState([]);

  // sound for a new student
  const joinSound = new Audio(
    "https://actions.google.com/sounds/v1/cartoon/pop.ogg"
  );

  // check API
  useEffect(() => {
    fetch(`${SOCKET_URL}/db-check`)
      .then((r) => r.json())
      .then(() => setStatus("✅ Backend OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  // socket listeners
  useEffect(() => {
    const handleLeaderboard = (scores) => {
      setLeaderboard(scores);
    };

    const handleRoster = (list) => {
      // debug
      console.log("roomRoster received:", list);
      setStudents((prev) => {
        if (list.length > prev.length) {
          // play on join
          joinSound.play().catch(() => {});
        }
        return list;
      });
    };

    socket.on("leaderboardUpdate", handleLeaderboard);
    socket.on("roomRoster", handleRoster);

    return () => {
      socket.off("leaderboardUpdate", handleLeaderboard);
      socket.off("roomRoster", handleRoster);
    };
  }, []);

  const handleLaunch = () => {
    if (!prompt.trim()) return;
    socket.emit("teacherLaunchTask", {
      roomCode,
      task: { prompt },
    });
  };

  const handleBonus = () => {
    socket.emit("teacherSpawnBonus", {
      roomCode,
      points: 5,
      durationMs: 8000,
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
        placeholder="Ask the question or describe the station…"
      />

      <button
        onClick={handleLaunch}
        style={{ background: "#2563eb", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
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

      {/* Students list */}
      <h2 style={{ marginTop: 24 }}>Students in room</h2>
      {students.length === 0 ? (
        <p>No one joined yet.</p>
      ) : (
        students.map((s) => (
          <p key={s.id}>{s.name || "Unnamed"}</p>
        ))
      )}

      {/* Leaderboard */}
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
