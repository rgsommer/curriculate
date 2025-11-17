import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export default function LiveSession({ server = 'http://localhost:4000', code }) {
  const [socket, setSocket] = useState(null);
  const [teams, setTeams] = useState([]);
  const [task, setTask] = useState(null);

  useEffect(() => {
    const s = io(server, { transports: ['websocket'] });
    setSocket(s);

    s.on('connect', () => {
      s.emit('joinRoom', { code, role: 'host' });
    });

    s.on('session:started', (payload) => {
      setTask(payload.task);
      setTeams(payload.teams || []);
    });

    s.on('task:started', (payload) => setTask(payload.task));

    s.on('scores:updated', (payload) => {
      setTeams(payload.teams || []);
    });

    return () => s.disconnect();
  }, [server, code]);

  function startSession() {
    socket && socket.emit('host:startSession', { code });
  }

  function nextTask() {
    socket && socket.emit('host:nextTask', { code });
  }

  function scoreTask() {
    if (!task) return;
    socket && socket.emit('host:scoreTask', { code, taskIndex: task.index ?? 0 });
  }

  return (
    <div>
      <h2>Live Session</h2>
      <div>Code: {code}</div>
      <button onClick={startSession}>Start Session</button>
      <button onClick={nextTask}>Next Task</button>
      <button onClick={scoreTask}>Score Task</button>
      <div>
        <h3>Current task</h3>
        <div>{task ? (task.title || task.prompt) : 'No current task'}</div>
      </div>
      <div>
        <h3>Teams</h3>
        <ul>
          {teams.map((t) => (
            <li key={t._id}>{t.name || t._id}: {t.score || 0}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
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
