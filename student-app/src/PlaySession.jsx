// student-app/src/PlaySession.jsx
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

// connect to your backend sockets
const socket = io(import.meta.env.VITE_API_URL);

export default function PlaySession() {
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);

  const [currentTask, setCurrentTask] = useState(null);
  const [answer, setAnswer] = useState("");
  const [startTime, setStartTime] = useState(null);

  const [bonus, setBonus] = useState(null);
  const [leaderboard, setLeaderboard] = useState({});

  // listen for events from server
  useEffect(() => {
    socket.on("taskUpdate", (task) => {
      setCurrentTask(task);
      setAnswer("");
      setStartTime(Date.now());
      setBonus(null); // clear old bonus
    });

    socket.on("bonusEvent", (evt) => {
      setBonus(evt);
    });

    socket.on("leaderboardUpdate", (scores) => {
      setLeaderboard(scores);
    });

    return () => {
      socket.off("taskUpdate");
      socket.off("bonusEvent");
      socket.off("leaderboardUpdate");
    };
  }, []);

  const handleJoin = () => {
    if (!roomCode || !name) return;
    socket.emit("joinRoom", { roomCode, name });
    setJoined(true);
  };

  const handleSubmit = () => {
    if (!currentTask) return;
    const elapsedMs = startTime ? Date.now() - startTime : null;

    // super simple correctness check for now:
    // if teacher sent task.answer, compare; otherwise just send correct=true
    const correct =
      currentTask.answer
        ? answer.trim().toLowerCase() === currentTask.answer.trim().toLowerCase()
        : true;

    socket.emit("submitTask", {
      roomCode,
      correct,
      elapsedMs,
      basePoints: 10,
    });

    // optionally clear after submit
    setCurrentTask(null);
  };

  const claimBonus = () => {
    if (!bonus) return;
    socket.emit("claimBonus", { roomCode, bonusId: bonus.id });
    setBonus(null);
  };

  return (
    <div style={{ maxWidth: 500, margin: "20px auto", fontFamily: "system-ui" }}>
      {!joined ? (
        <div style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h1 style={{ fontSize: "1.4rem", marginBottom: 12 }}>Join your Curriculate game</h1>
          <label>Room code</label>
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="e.g. 8ABC"
            style={{ display: "block", marginBottom: 12, width: "100%", padding: 6 }}
          />
          <label>Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{ display: "block", marginBottom: 12, width: "100%", padding: 6 }}
          />
          <button
            onClick={handleJoin}
            style={{ background: "#0f766e", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
          >
            Join
          </button>
        </div>
      ) : (
        <>
          <h2 style={{ fontSize: "1.2rem" }}>
            Room: <strong>{roomCode}</strong>
          </h2>
          <p style={{ color: "#666" }}>Hi, {name}! Wait for your teacher to launch a task.</p>

          {/* BONUS POPUP */}
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

          {/* CURRENT TASK */}
          <div style={{ marginTop: 16 }}>
            {!currentTask ? (
              <p style={{ color: "#94a3b8" }}>Waiting for the next task…</p>
            ) : (
              <div
                style={{
                    background: "#fff",
                    padding: 16,
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                  }}
              >
                <h3 style={{ marginBottom: 8 }}>Task:</h3>
                <p style={{ marginBottom: 12 }}>{currentTask.prompt}</p>

                {/* simple text answer for now */}
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer"
                  style={{ width: "100%", padding: 6, marginBottom: 12 }}
                />

                <button
                  onClick={handleSubmit}
                  style={{ background: "#2563eb", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}
                >
                  Submit
                </button>
              </div>
            )}
          </div>

          {/* LEADERBOARD PREVIEW */}
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
        </>
      )}
    </div>
  );
}
