// student-app/src/App.jsx
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL;
const socket = io(API_URL);

export default function App() {
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Checking backend...");

  const [currentTask, setCurrentTask] = useState(null);
  const [answer, setAnswer] = useState("");
  const [startTime, setStartTime] = useState(null);

  const [bonus, setBonus] = useState(null);
  const [leaderboard, setLeaderboard] = useState({});
  const [flash, setFlash] = useState(false);

  // simple sounds (use your own URLs later)
  const taskSound = new Audio("https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg");
  const bonusSound = new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg");
  const submitSound = new Audio("https://actions.google.com/sounds/v1/cartoon/slide_whistle_to_drum_hit.ogg");
  const countdownSound = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");

  // backend check
  useEffect(() => {
    fetch(`${API_URL}/db-check`)
      .then((r) => r.json())
      .then(() => setStatus("✅ API OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  // socket listeners
  useEffect(() => {
    socket.on("taskUpdate", (task) => {
      setCurrentTask(task);
      setAnswer("");
      setStartTime(Date.now());
      setBonus(null);
      setFlash(false);
      // play task sound
      taskSound.play().catch(() => {});
    });

    socket.on("leaderboardUpdate", (scores) => setLeaderboard(scores));

    socket.on("bonusEvent", (evt) => {
      setBonus(evt);
      bonusSound.play().catch(() => {});
    });

    return () => {
      socket.off("taskUpdate");
      socket.off("leaderboardUpdate");
      socket.off("bonusEvent");
    };
  }, []);

  // flashing timer for last 5 seconds (assuming tasks can have durationMs)
  useEffect(() => {
    if (!currentTask || !currentTask.durationMs) return;
    const duration = currentTask.durationMs;
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = duration - elapsed;
      if (remaining <= 5000 && remaining > 0) {
        setFlash((f) => !f);
        countdownSound.play().catch(() => {});
      }
      if (remaining <= 0) {
        clearInterval(interval);
        setFlash(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [currentTask, startTime]);

  const handleJoin = () => {
    if (!roomCode.trim()) return;
    const userName = name.trim() || "Anonymous";
    socket.emit("joinRoom", { roomCode: roomCode.toUpperCase(), name: userName });
    setJoined(true);
  };

  const handleSubmit = () => {
    if (!currentTask) return;
    const elapsedMs = startTime ? Date.now() - startTime : null;
    const correct = currentTask.answer
      ? answer.trim().toLowerCase() === currentTask.answer.trim().toLowerCase()
      : true;

    socket.emit("submitTask", {
      roomCode,
      correct,
      elapsedMs,
      basePoints: 10,
    });

    if (correct) {
      submitSound.play().catch(() => {});
    }

    setCurrentTask(null);
    setFlash(false);
  };

  const claimBonus = () => {
    if (!bonus) return;
    socket.emit("claimBonus", { roomCode, bonusId: bonus.id });
    setBonus(null);
  };

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "30px auto",
        fontFamily: "system-ui",
      }}
      className={flash ? "flash-screen" : ""}
    >
      <h1>Curriculate — Student</h1>
      <p style={{ fontSize: "0.8rem" }}>Backend: {status}</p>

      {/* JOIN SCREEN */}
      {!joined ? (
        <div style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <label>Room code</label>
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="e.g. GRADE8A"
            style={{ display: "block", marginTop: 6, marginBottom: 12, padding: 6, width: "100%" }}
          />
          <label>Your name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{ display: "block", marginTop: 6, marginBottom: 12, padding: 6, width: "100%" }}
          />
          <button
            onClick={handleJoin}
            style={{ background: "#0f766e", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
          >
            Join
          </button>
        </div>
      ) : (
        // GAME SCREEN
        <div style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h2>Room {roomCode.toUpperCase()}</h2>
          <p>Welcome, {name || "player"}!</p>

          {bonus && (
            <div
              onClick={claimBonus}
              style={{
                background: "#facc15",
                padding: 10,
                borderRadius: 8,
                marginTop: 12,
                cursor: "pointer",
              }}
            >
              🐾 Bonus! Tap to claim +{bonus.points} points!
            </div>
          )}

          {currentTask ? (
            <div style={{ marginTop: 16 }}>
              <h3>Task</h3>
              <p style={{ marginBottom: 12 }}>{currentTask.prompt}</p>
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer"
                style={{ width: "100%", padding: 6, marginBottom: 12 }}
              />
              <button
                onClick={handleSubmit}
                style={{ background: "#2563eb", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
              >
                Submit
              </button>
            </div>
          ) : (
            <p style={{ color: "#94a3b8", marginTop: 16 }}>Waiting for the next task…</p>
          )}

          {/* Leaderboard */}
          <div style={{ marginTop: 20 }}>
            <h3>Leaderboard</h3>
            <div style={{ background: "#f8fafc", padding: 10, borderRadius: 8 }}>
              {Object.entries(leaderboard).length === 0 && <p>No scores yet.</p>}
              {Object.entries(leaderboard)
                .sort((a, b) => b[1] - a[1])
                .map(([studentName, score], idx) => (
                  <p key={studentName}>
                    {idx + 1}. {studentName} — {score} pts
                  </p>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
