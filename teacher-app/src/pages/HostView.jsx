// MERGED VERSION: keeps original layout + adds join sound + locationCode

import React, { useEffect, useRef, useState } from "react";
import { socket } from "../socket";

export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
    taskIndex: -1,
    locationCode: "Classroom",
  });
  const [submissions, setSubmissions] = useState([]);

  const joinSoundRef = useRef(null);

  // ------------------------------------------------------------
  // Load join sound + unlock it on first click (autoplay-safe)
  // ------------------------------------------------------------
  useEffect(() => {
    const audio = new Audio("/sounds/join.mp3");
    audio.load();
    joinSoundRef.current = audio;
  }, []);

  useEffect(() => {
    const unlock = () => {
      const a = joinSoundRef.current;
      if (!a) return;
      a.muted = true;
      a.play().then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      }).catch(() => {});
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);

  // ------------------------------------------------------------
  // Join as a host / viewer for this room
  // ------------------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();

    socket.emit("joinRoom", {
      roomCode: code,
      role: "host",
      name: "Host",
    });

    const handleRoom = (state) => {
      setRoomState(
        state || {
          stations: [],
          teams: {},
          scores: {},
          taskIndex: -1,
          locationCode: "Classroom",
        }
      );
    };

    const handleSubmission = (sub) => {
      if (!sub) return;
      setSubmissions((prev) => [sub, ...prev].slice(0, 20));
    };

    const handleTeamJoined = () => {
      const a = joinSoundRef.current;
      if (a) {
        a.currentTime = 0;
        a.play().catch(() => {});
      }
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("taskSubmission", handleSubmission);
    socket.on("team:joined", handleTeamJoined);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("taskSubmission", handleSubmission);
      socket.off("team:joined", handleTeamJoined);
    };
  }, [roomCode]);

  const teamsById = roomState.teams || {};
  const teamsArray = Object.values(teamsById);
  const scoresEntries = Object.entries(roomState.scores || {}).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        gap: 16,
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      {/* Left column: room + teams */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <h1 style={{ marginTop: 0 }}>Host view</h1>
        {roomCode ? (
          <>
            <p style={{ marginTop: 0 }}>
              Room: <strong>{roomCode.toUpperCase()}</strong>
            </p>
            <p
              style={{
                marginTop: 0,
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              Location:{" "}
              <strong>{roomState.locationCode || "Classroom"}</strong>
            </p>
          </>
        ) : (
          <p style={{ color: "#b91c1c" }}>No room selected.</p>
        )}

        <h2 style={{ marginTop: 24, marginBottom: 8 }}>Teams</h2>
        {teamsArray.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No teams joined yet.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {teamsArray.map((team) => (
              <div
                key={team.teamId}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#e5e7eb",
                }}
              >
                <div style={{ fontWeight: 600 }}>{team.teamName}</div>
                {Array.isArray(team.members) && team.members.length > 0 && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#4b5563",
                      marginTop: 2,
                    }}
                  >
                    {team.members.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Middle: latest submissions */}
      <div
        style={{
          flex: 1.2,
          minWidth: 260,
          borderLeft: "1px solid #e5e7eb",
          paddingLeft: 16,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Latest submissions</h2>
        {submissions.length === 0 ? (
          <p style={{ color: "#6b7280" }}>None yet.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {submissions.map((s, idx) => {
              const when = s.submittedAt
                ? new Date(s.submittedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "";

              return (
                <div
                  key={idx}
                  style={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    padding: "8px 10px",
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                    }}
                  >
                    <div>
                      <strong>
                        {s.teamName || teamsById[s.teamId]?.teamName}
                      </strong>{" "}
                      {s.correct === null
                        ? ""
                        : s.correct
                        ? "✅"
                        : "❌"}{" "}
                      {s.points != null && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "#4b5563",
                          }}
                        >
                          ({s.points} pts)
                        </span>
                      )}
                    </div>
                    {when && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "#6b7280",
                        }}
                      >
                        {when}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: "0.85rem",
                      color: "#111827",
                    }}
                  >
                    {s.answerText && s.answerText.trim()
                      ? s.answerText
                      : "(no text answer)"}
                  </div>
                  {s.timeMs != null && (
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: "0.75rem",
                        color: "#6b7280",
                      }}
                    >
                      Time: {(s.timeMs / 1000).toFixed(1)}s
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: leaderboard */}
      <div
        style={{
          flex: 0.9,
          minWidth: 220,
          borderLeft: "1px solid #e5e7eb",
          paddingLeft: 16,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Leaderboard</h2>
        {scoresEntries.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No scores yet.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {scoresEntries.map(([teamId, pts]) => {
              const teamName = teamsById[teamId]?.teamName || teamId;
              return (
                <li key={teamId} style={{ marginBottom: 4 }}>
                  <strong>{teamName}</strong> — {pts} pts
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
