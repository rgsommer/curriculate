import React, { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [status, setStatus] = useState("Checking backend...");
  const [roomCode, setRoomCode] = useState("GRADE8A");

  useEffect(() => {
    fetch(`${API_URL}/db-check`)
      .then(r => r.json())
      //.then(d => setStatus(JSON.stringify(d)))
      .then(d => setStatus("API OK"))
      .catch(() => setStatus("❌ cannot reach API"));
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui" }}>
      {/* sidebar */}
      <div style={{ width: 220, background: "#18233a", color: "#fff", padding: 16 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Curriculate</h2>
        <p style={{ opacity: 0.6, fontSize: "0.7rem" }}>Teacher</p>
        <a href="/" style={{ color: "#fff", display: "block", marginTop: 12 }}>Dashboard</a>
        <a href="/display" style={{ color: "#fff", display: "block", marginTop: 8 }}>Classroom Display</a>
      </div>

      {/* content */}
      <div style={{ flex: 1, padding: 20 }}>
        <h1>Teacher Dashboard</h1>
        <p style={{ fontSize: "0.8rem" }}>Backend status: {status}</p>

        <div style={{ marginTop: 20, background: "#fff", padding: 16, border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <h2>Launch a task set</h2>
          <label>Room code</label>
          <input value={roomCode} onChange={e => setRoomCode(e.target.value)}
            style={{ display: "block", marginTop: 6, marginBottom: 12, padding: 6 }} />

          {/* later this button will emit socket.io "launchSet" */}
          <button style={{ background: "#2b6cb0", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6 }}>
            Launch (not wired yet)
          </button>
        </div>
      </div>
    </div>
  );
}
