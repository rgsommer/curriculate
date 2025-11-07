import React, { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [roomCode, setRoomCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Checking backend...");

  useEffect(() => {
    fetch(`${API_URL}/db-check`)
      .then(r => r.json())
      .then(d => setStatus("API OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: "30px auto", fontFamily: "system-ui" }}>
      <h1>Curriculate — Student</h1>
      <p style={{ fontSize: "0.8rem" }}>Backend: {status}</p>
      {!joined ? (
        <div style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <label>Room code</label>
          <input value={roomCode} onChange={e => setRoomCode(e.target.value)}
            placeholder="e.g. GRADE8A"
            style={{ display: "block", marginTop: 6, marginBottom: 12, padding: 6, width: "100%" }} />
          <button onClick={() => setJoined(true)}
            style={{ background: "#0f766e", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}>
            Join
          </button>
        </div>
      ) : (
        <div style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h2>Waiting for teacher…</h2>
          <p>You joined room <strong>{roomCode}</strong>. When the teacher launches a task, it will appear here.</p>
        </div>
      )}
    </div>
  );
}
