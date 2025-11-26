// teacher-app/src/pages/HostView.jsx
// Host dashboard: overview of stations, teams, scores, and latest submissions.
// Uses backend-backed recentSubmissions so history persists across view switches.

import React, { useEffect, useRef, useState } from "react";
import { socket } from "../socket";

export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
    taskIndex: -1,
    locationCode: "Classroom",
    recentSubmissions: [],
  });

  const [submissions, setSubmissions] = useState([]);
  const joinSoundRef = useRef(null);

  // Preload join sound
  useEffect(() => {
    const audio = new Audio("/sounds/join.mp3");
    audio.load();
    joinSoundRef.current = audio;
  }, []);

  // Unlock audio on first click
  useEffect(() => {
    const unlock = () => {
      const a = joinSoundRef.current;
      if (!a) return;
      a.muted = true;
      a
        .play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {});
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);

  // Join the room as host whenever roomCode changes
  useEffect(() => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("joinRoom", {
      roomCode: code,
      role: "host",
      name: "Host",
    });
  }, [roomCode]);

  useEffect(() => {
    const handleRoom = (state) => {
      const safe = state || {
        stations: [],
        teams: {},
        scores: {},
        taskIndex: -1,
        locationCode: "Classroom",
        recentSubmissions: [],
      };

      setRoomState(safe);

      // If backend sends recentSubmissions and our local list is empty,
      // seed the list so history persists across view switches.
      if (
        Array.isArray(safe.recentSubmissions) &&
        safe.recentSubmissions.length > 0 &&
        submissions.length === 0
      ) {
        // newest first
        const seeded = safe.recentSubmissions.slice().reverse();
        setSubmissions(seeded);
      }
    };

    const handleSubmission = (sub) => {
      if (!sub) return;
      setSubmissions((prev) => [sub, ...prev].slice(0, 20));
    };

    const handleTeamJoined = (info) => {
      console.log("[HostView] team joined:", info);
      if (joinSoundRef.current) {
        joinSoundRef.current.currentTime = 0;
        joinSoundRef.current.play().catch(() => {});
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
  }, [submissions.length]);

  const { stations, teams = {}, scores = {}, taskIndex, locationCode } =
    roomState;

  const teamsArray = Object.values(teams);
  const scoresEntries = Object.entries(scores).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 16,
        fontFamily: "system-ui",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Host view</h1>
          {roomCode ? (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.9rem",
                  color: "#4b5563",
                }}
              >
                Room: {roomCode.toUpperCase()}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#6b7280",
                }}
              >
                Location: {locationCode || "Classroom"} • Task index:{" "}
                {taskIndex >= 0 ? taskIndex + 1 : "—"}
              </p>
            </>
          ) : (
            <p style={{ color: "#b91c1c" }}>No room selected.</p>
          )}
        </div>

        {/* Simple legend / status */}
        <div
          style={{
            padding: 8,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            fontSize: "0.8rem",
            minWidth: 220,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Session summary
          </div>
          <div>
            Teams joined: <strong>{teamsArray.length}</strong>
          </div>
          <div>
            Stations: <strong>{stations.length}</strong>
          </div>
          <div>
            Latest submissions:{" "}
            <strong>{submissions.length}</strong>
          </div>
        </div>
      </div>

      {/* Main body: stations/teams + submissions + scores */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 2fr 1.4fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Stations column */}
        <div
          style={{
            borderRight: "1px solid #e5e7eb",
            paddingRight: 12,
            minWidth: 0,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Stations</h2>
          {stations.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No stations are defined yet.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {stations.map((s) => {
                const team = teams[s.assignedTeamId] || null;
                return (
                  <div
                    key={s.id}
                    style={{
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      padding: 8,
                      background: "#ffffff",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          color: "#6b7280",
                        }}
                      >
                        {s.id}
                      </div>
                      <div>
                        {team
                          ? team.teamName || team.teamId
                          : "No team assigned"}
                      </div>
                    </div>
                    {team && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#6b7280",
                        }}
                      >
                        Score: {scores[team.teamId] ?? 0}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Teams column */}
        <div
          style={{
            borderRight: "1px solid #e5e7eb",
            paddingRight: 12,
            minWidth: 0,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Teams</h2>
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
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    padding: 8,
                    fontSize: "0.85rem",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {team.teamName || team.teamId}
                  </div>
                  {Array.isArray(team.members) &&
                    team.members.length > 0 && (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: "0.75rem",
                          color: "#6b7280",
                        }}
                      >
                        {team.members.join(", ")}
                      </div>
                    )}
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: "0.75rem",
                      color: "#6b7280",
                    }}
                  >
                    Current station:{" "}
                    {team.currentStationId || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: latest submissions + scores */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minWidth: 0,
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>
              Latest submissions
            </h2>
            {submissions.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: "0.85rem" }}>
                No submissions yet.
              </p>
            ) : (
              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: 6,
                  fontSize: "0.8rem",
                }}
              >
                {submissions.map((sub, idx) => {
                  const t = sub.submittedAt
                    ? new Date(sub.submittedAt)
                    : null;
                  const timeStr = t
                    ? t.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "";

                  const isCorrect =
                    sub.correct === true
                      ? "✅"
                      : sub.correct === false
                      ? "❌"
                      : "•";

                  return (
                    <div
                      key={`${sub.teamId}-${sub.taskIndex}-${idx}`}
                      style={{
                        padding: "3px 4px",
                        borderBottom:
                          idx === submissions.length - 1
                            ? "none"
                            : "1px dashed #e5e7eb",
                      }}
                    >
                      <div>
                        <strong>{sub.teamName || sub.teamId}</strong>{" "}
                        {timeStr && (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              color: "#6b7280",
                            }}
                          >
                            • {timeStr}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={sub.answerText}
                      >
                        {isCorrect} T{(sub.taskIndex ?? 0) + 1}:{" "}
                        {sub.answerText || "—"}
                      </div>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "#6b7280",
                        }}
                      >
                        {sub.points ?? 0} pts{" "}
                        {sub.timeMs != null &&
                          `• ${(sub.timeMs / 1000).toFixed(1)}s`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Scores</h2>
            {scoresEntries.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                No scores yet.
              </p>
            ) : (
              <ol
                style={{
                  paddingLeft: 20,
                  margin: 0,
                  fontSize: "0.85rem",
                }}
              >
                {scoresEntries.map(([teamId, pts]) => {
                  const teamName =
                    teams[teamId]?.teamName || teamId;
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
      </div>
    </div>
  );
}
