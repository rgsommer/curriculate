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
  const scoresEntries = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  // Basic shared styles (matching Task Sets vibe)
  const wrapperStyle = {
    padding: 24,
    maxWidth: 1100,
    margin: "0 auto",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#111827",
  };

  const cardStyle = {
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    padding: 10,
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  };

  const sectionTitleStyle = {
    fontSize: "0.9rem",
    fontWeight: 600,
    marginBottom: 6,
  };

  const smallText = {
    fontSize: "0.8rem",
    color: "#4b5563",
  };

  const mutedText = {
    fontSize: "0.8rem",
    color: "#6b7280",
  };

  const visuallyHidden = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  };

  return (
    <div style={wrapperStyle}>
      {/* Accessible page title (hidden visually – top bar already shows it) */}
      <h1 style={visuallyHidden}>Host view</h1>

      {/* Header row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          {roomCode ? (
            <>
              <p
                style={{
                  fontSize: "0.75rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#6b7280",
                  margin: 0,
                  marginBottom: 2,
                }}
              >
                Room {roomCode.toUpperCase()}
              </p>
              <p style={{ ...smallText, margin: 0 }}>
                Location:{" "}
                <span style={{ fontWeight: 600 }}>
                  {locationCode || "Classroom"}
                </span>
              </p>
              <p style={{ ...mutedText, margin: "4px 0 0" }}>
                Task index:{" "}
                {taskIndex >= 0 ? (
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {taskIndex + 1}
                  </span>
                ) : (
                  "—"
                )}
              </p>
            </>
          ) : (
            <p style={{ ...smallText, color: "#b91c1c", margin: 0 }}>
              No room selected. Choose a room from the main bar.
            </p>
          )}
        </div>

        {/* Session summary card */}
        <div style={{ ...cardStyle, minWidth: 220 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 4 }}>
            Session summary
          </div>
          <div style={{ ...smallText, marginBottom: 2 }}>
            Teams joined:{" "}
            <span style={{ fontWeight: 600 }}>{teamsArray.length}</span>
          </div>
          <div style={{ ...smallText, marginBottom: 2 }}>
            Stations:{" "}
            <span style={{ fontWeight: 600 }}>{stations.length}</span>
          </div>
          <div style={smallText}>
            Latest submissions:{" "}
            <span style={{ fontWeight: 600 }}>{submissions.length}</span>
          </div>
        </div>
      </div>

      {/* Main grid: Stations | Teams | Submissions+Scores */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 0.9fr)",
          gap: 12,
        }}
      >
        {/* Stations column */}
        <div>
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Stations</div>
            {stations.length === 0 ? (
              <p style={{ ...smallText, color: "#6b7280", margin: 0 }}>
                No stations are defined yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stations.map((s) => {
                  const team = teams[s.assignedTeamId] || null;
                  return (
                    <div
                      key={s.id}
                      style={{
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        background: "#f9fafb",
                        padding: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "0.8rem",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "#6b7280",
                          }}
                        >
                          {s.id}
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#111827" }}>
                          {team
                            ? team.teamName || team.teamId
                            : "No team assigned"}
                        </div>
                      </div>
                      {team && (
                        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                          Score: {scores[team.teamId] ?? 0}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Teams column */}
        <div>
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Teams</div>
            {teamsArray.length === 0 ? (
              <p style={{ ...smallText, color: "#6b7280", margin: 0 }}>
                No teams joined yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {teamsArray.map((team) => (
                  <div
                    key={team.teamId}
                    style={{
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      padding: 8,
                      fontSize: "0.8rem",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        color: "#111827",
                        fontSize: "0.9rem",
                      }}
                    >
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
                        marginTop: 2,
                        fontSize: "0.75rem",
                        color: "#6b7280",
                      }}
                    >
                      Current station:{" "}
                      <span
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {team.currentStationId || "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: submissions + scores */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Latest submissions</div>
            {submissions.length === 0 ? (
              <p style={{ ...smallText, color: "#9ca3af", margin: 0 }}>
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
                  fontSize: "0.75rem",
                }}
              >
                {submissions.map((sub, idx) => {
                  const t = sub.submittedAt ? new Date(sub.submittedAt) : null;
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
                        padding: "4px 2px",
                        borderBottom: "1px dashed #e5e7eb",
                        lastChild: { borderBottom: "none" },
                      }}
                    >
                      <div>
                        <strong>
                          {sub.teamName || sub.teamId || "Unknown team"}
                        </strong>{" "}
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

          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Scores</div>
            {scoresEntries.length === 0 ? (
              <p style={{ ...smallText, color: "#6b7280", margin: 0 }}>
                No scores yet.
              </p>
            ) : (
              <ol
                style={{
                  paddingLeft: 18,
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#111827",
                }}
              >
                {scoresEntries.map(([teamId, pts]) => {
                  const teamName = teams[teamId]?.teamName || teamId;
                  return (
                    <li key={teamId} style={{ marginBottom: 2 }}>
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
