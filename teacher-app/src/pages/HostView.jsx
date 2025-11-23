// teacher-app/src/pages/HostView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { socket } from "../socket";

/**
 * HostView
 *
 * Simple projector view for the room:
 * - Listens for room state (teams + scores).
 * - Shows a big, clean leaderboard and optional station information.
 *
 * It does NOT create the room – LiveSession should do that.
 * Here we just join the same Socket.IO room and mirror whatever the teacher sees.
 */
export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    roomCode: "",
    stations: [],
    teams: {},
    scores: {},
  });

  useEffect(() => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    const handleRoomState = (state) => {
      if (!state) return;
      setRoomState((prev) => ({ ...prev, ...state }));
    };

    // Join the socket.io room as a passive viewer. Different backends name this differently,
    // so we call a couple of events to be safe.
    socket.emit("host:joinRoom", { roomCode: code });
    socket.emit("teacher:joinView", { roomCode: code });

    // And always listen for both old + new room-state event names:
    socket.on("roomState", handleRoomState);
    socket.on("room:state", handleRoomState);
    socket.on("room:update", handleRoomState);

    return () => {
      socket.off("roomState", handleRoomState);
      socket.off("room:state", handleRoomState);
      socket.off("room:update", handleRoomState);
    };
  }, [roomCode]);

  const scores = roomState.scores || {};
  const teamsArray = useMemo(() => {
    const teams = roomState.teams || {};
    return Object.values(teams);
  }, [roomState]);

  const leaderboard = useMemo(() => {
    if (!teamsArray.length) return [];
    return teamsArray
      .map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName || "Unnamed team",
        members: team.members || [],
        points: scores[team.teamId] ?? 0,
      }))
      .sort((a, b) => b.points - a.points);
  }, [teamsArray, scores]);

  const roomLabel = roomState.roomCode || roomCode || "—";

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "30px 40px",
        background: "#020617",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.8rem",
              letterSpacing: 1,
            }}
          >
            Curriculate – Live
          </h1>
          <p
            style={{
              margin: 0,
              marginTop: 4,
              fontSize: "0.9rem",
              color: "#9ca3af",
            }}
          >
            Room code:{" "}
            <span
              style={{
                fontWeight: 700,
                letterSpacing: 3,
                fontSize: "1.1rem",
              }}
            >
              {roomLabel}
            </span>
          </p>
        </div>
      </header>

      <main>
        <section style={{ marginBottom: 32 }}>
          <h2
            style={{
              margin: 0,
              marginBottom: 12,
              fontSize: "1.4rem",
            }}
          >
            Leaderboard
          </h2>

          {leaderboard.length === 0 ? (
            <p style={{ fontSize: "1rem", color: "#9ca3af" }}>
              Waiting for teams to join…
            </p>
          ) : (
            <div>
              {leaderboard.map((entry, index) => (
                <div
                  key={entry.teamId || index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom:
                      index === leaderboard.length - 1
                        ? "none"
                        : "1px solid rgba(148,163,184,0.3)",
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      textAlign: "right",
                      paddingRight: 12,
                      fontWeight: 700,
                      fontSize: "1.2rem",
                      color: index === 0 ? "#f97316" : "#e5e7eb",
                    }}
                  >
                    {index + 1}.
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: "1.1rem",
                        fontWeight: 600,
                      }}
                    >
                      {entry.teamName}
                    </div>
                    {entry.members.length > 0 && (
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "#9ca3af",
                        }}
                      >
                        {entry.members.join(", ")}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      minWidth: 80,
                      textAlign: "right",
                      fontSize: "1.1rem",
                      fontWeight: 700,
                    }}
                  > 
                    {entry.points} pts
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
