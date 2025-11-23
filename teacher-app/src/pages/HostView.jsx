// teacher-app/src/pages/HostView.jsx
import React, { useEffect, useState } from "react";
import { socket } from "../socket";

export default function HostView({ roomCode }) {  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
  });
  const [submissions, setSubmissions] = useState([]);
  const [scoreInputs, setScoreInputs] = useState({}); // teamId -> points

  // join as host 
  useEffect(() => {
    if (!roomCode) return;
    socket.emit("joinRoom", {
      roomCode: roomCode.toUpperCase(),
      name: "Host",
      role: "host",
    });
  }, [roomCode]);

  // listen
  useEffect(() => {
    const handleRoom = (state) =>
      setRoomState(state || { stations: [], teams: {}, scores: {} });

    const handleSubmission = (sub) => {
      setSubmissions((prev) => [sub, ...prev].slice(0, 30));
    };

    socket.on("roomState", handleRoom);
    socket.on("taskSubmission", handleSubmission);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("taskSubmission", handleSubmission);
    };
  }, []);

  const handleScore = (teamId) => {
    if (!roomCode) return;
    const pts = Number(scoreInputs[teamId] || 0);
    socket.emit("hostScoreSubmission", {
      roomCode: roomCode.toUpperCase(),
      teamId,
      points: pts,
    });
    // clear
    setScoreInputs((prev) => ({ ...prev, [teamId]: "" }));
  };

  const teamsArray = Object.values(roomState.teams || {});
  const scoresEntries = Object.entries(roomState.scores || {}).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div style={{ height: "100%", display: "flex", gap: 16 }}>
      {/* left + middle */}
      <div style={{ flex: 1 }}>
        <h1>Host view</h1>
        {roomCode ? (
          <p>Room: {roomCode.toUpperCase()}</p>
        ) : (
          <p style={{ color: "#b91c1c" }}>No room selected.</p>
        )}

        <h2>Teams</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {teamsArray.length === 0 ? (
            <p>No teams yet.</p>
          ) : (
            teamsArray.map((t) => (
              <div
                key={t.teamId}
                style={{
                  background: t.teamColor || "rgba(148,163,184,0.25)",
                  color: t.teamColor ? "#fff" : "#000",
                  padding: "8px 12px",
                  borderRadius: 10,
                  minWidth: 150,
                }}
              >
                <strong>{t.teamName}</strong>{" "}
                {t.teamColor ? `(${t.teamColor})` : ""}
                {(t.members || []).length > 0 && (
                  <div style={{ fontSize: "0.7rem" }}>
                    {t.members.join(", ")}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <h2 style={{ marginTop: 20 }}>Latest submissions</h2>
        {submissions.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {submissions.map((s, i) => (
              <li
                key={i}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginBottom: 8,
                }}
              >
                <div>
                  <strong>{s.teamName}</strong>{" "}
                  {s.correct ? "✅" : "❌"}{" "}
                  <span style={{ fontSize: "0.7rem", color: "#475569" }}>
                    {s.timeMs ? `${Math.round(s.timeMs / 1000)}s` : ""}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  {s.answerText && s.answerText.trim()
                    ? s.answerText
                    : "(no text submitted)"}
                </div>
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <input
                    type="number"
                    placeholder="pts"
                    value={scoreInputs[s.teamId] ?? ""}
                    onChange={(e) =>
                      setScoreInputs((prev) => ({
                        ...prev,
                        [s.teamId]: e.target.value,
                      }))
                    }
                    style={{
                      width: 70,
                      padding: 4,
                      border: "1px solid #cbd5f5",
                      borderRadius: 4,
                    }}
                  />
                  <button
                    onClick={() => handleScore(s.teamId)}
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      padding: "4px 10px",
                      borderRadius: 5,
                      cursor: "pointer",
                    }}
                  >
                    Score
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* right: leaderboard */}
      <div
        style={{
          width: 240,
          borderLeft: "1px solid #e2e8f0",
          paddingLeft: 16,
        }}
      >
        <h2>Leaderboard</h2>
        {scoresEntries.length === 0 ? (
          <p>No scores yet.</p>
        ) : (
          scoresEntries.map(([name, pts], idx) => (
            <p key={name}>
              {idx + 1}. {name} — {pts} pts
            </p>
          ))
        )}
      </div>
    </div>
  );
}
