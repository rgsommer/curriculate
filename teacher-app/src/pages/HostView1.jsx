// teacher-app/src/pages/HostView.jsx
import React, { useEffect, useState } from "react";
import { socket } from "../socket";

/**
 * Projector-style host view.
 * - Creates the room (teacher:createRoom) when a roomCode is provided.
 * - Listens to room:state updates from the server.
 * - Shows teams, their stations and scores, plus a simple leaderboard.
 *
 * NOTE: This view relies on the same socket instance as the rest of the
 * teacher app. It should usually be opened AFTER a room code is chosen
 * in TeacherApp.
 */
export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    teams: {},
    stations: {},
    scores: {},
    taskIndex: -1,
  });

  const [status, setStatus] = useState("Waiting for room…");

  // Create / join the room as the teacher host
  useEffect(() => {
    if (!roomCode) {
      setStatus("No room selected.");
      return;
    }

    const code = roomCode.toUpperCase();
    setStatus(`Creating room ${code}…`);

    socket.emit("teacher:createRoom", { roomCode: code });

    // We don't need any cleanup here; the socket stays connected
  }, [roomCode]);

  // Listen for room:state broadcasts
  useEffect(() => {
    const handleRoomState = (state) => {
      if (!state) return;
      setRoomState(state);
      setStatus("Live – teams & scores updating.");
    };

    socket.on("room:state", handleRoomState);

    return () => {
      socket.off("room:state", handleRoomState);
    };
  }, []);

  const teamsArray = Object.values(roomState.teams || {});
  const scoresByTeamId = roomState.scores || {};

  const leaderboard = [...teamsArray]
    .map((t) => ({
      ...t,
      points: scoresByTeamId[t.teamId] || 0,
    }))
    .sort((a, b) => b.points - a.points);

  return (
    <div
      style={{
        height: "100%",
        padding: "16px 24px",
        boxSizing: "border-box",
        display: "flex",
        gap: 24,
        background: "#020617",
        color: "#f9fafb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Left: room + team grid */}
      <div style={{ flex: 2, minWidth: 0 }}>
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Host View</h1>
            <p style={{ margin: "4px 0", fontSize: "0.9rem", opacity: 0.9 }}>
              {status}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>Room code</div>
            <div
              style={{
                fontSize: "1.8rem",
                letterSpacing: "0.2em",
                fontWeight: 700,
              }}
            >
              {roomCode ? roomCode.toUpperCase() : "— —"}
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Teams</h2>
        {teamsArray.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No teams have joined yet.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            {teamsArray.map((team) => {
              const points = scoresByTeamId[team.teamId] || 0;
              const color = team.stationColor || "gray";

              return (
                <div
                  key={team.teamId}
                  style={{
                    minWidth: 160,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "#020617",
                    border: "1px solid rgba(148, 163, 184, 0.5)",
                    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.8)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "1rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {team.teamName}
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.9,
                      }}
                    >
                      {points} pts
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        background:
                          color === "gray"
                            ? "rgba(148, 163, 184, 0.7)"
                            : color,
                        border: "1px solid rgba(15,23,42,0.8)",
                      }}
                    />
                    <span style={{ fontSize: "0.8rem", opacity: 0.9 }}>
                      {color === "gray"
                        ? "No station yet"
                        : `${color} station`}
                    </span>
                  </div>
                  {team.members && team.members.length > 0 && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        opacity: 0.8,
                        lineHeight: 1.3,
                      }}
                    >
                      {team.members.join(", ")}
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
          flex: 1,
          minWidth: 0,
          padding: 16,
          borderRadius: 16,
          background:
            "radial-gradient(circle at top, rgba(56,189,248,0.25), transparent 60%), #020617",
          border: "1px solid rgba(148, 163, 184, 0.5)",
          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.9)",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.2rem", marginBottom: 8 }}>
          Leaderboard
        </h2>
        {leaderboard.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No scores yet.</p>
        ) : (
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {leaderboard.map((team, index) => (
              <li
                key={team.teamId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: 999,
                  background:
                    index === 0
                      ? "rgba(34,197,94,0.12)"
                      : "rgba(15,23,42,0.6)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      opacity: 0.9,
                    }}
                  >
                    {index + 1}.
                  </span>
                  <span
                    style={{
                      fontWeight: index === 0 ? 600 : 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {team.teamName}
                  </span>
                </div>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "0.9rem",
                  }}
                >
                  {team.points} pts
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
