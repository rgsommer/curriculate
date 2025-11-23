// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useMemo, useState } from "react";
import { socket } from "../socket";

/**
 * LiveSession
 *
 * Teacher control panel for a single live room.
 * - Creates / joins the room for the given roomCode.
 * - Listens for room state (teams, stations, scores).
 * - Can start the session (which should cause the backend to assign stations).
 * - Shows which team has which station colour so you can see if assignment is working.
 */
export default function LiveSession({ roomCode }) {
  const [status, setStatus] = useState("Not connected");
  const [roomState, setRoomState] = useState({
    roomCode: "",
    stations: [],
    teams: {},
    scores: {},
    taskset: null,
  });

  // Handy derived arrays for rendering
  const teamsArray = useMemo(() => {
    const teams = roomState?.teams || {};
    return Object.values(teams);
  }, [roomState]);

  const stationsArray = useMemo(() => {
    const raw = roomState?.stations || [];
    if (Array.isArray(raw)) {
      return raw.map((s, idx) => {
        if (typeof s === "string") {
          return { id: s, label: s, index: idx };
        }
        return {
          id: s.id || s.stationId || `station-${idx + 1}`,
          label: s.label || s.name || s.color || `Station ${idx + 1}`,
          color: s.color || s.colorName || null,
          index: idx,
        };
      });
    }
    return [];
  }, [roomState]);

  // Join / create the room and wire up event listeners
  useEffect(() => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();
    setStatus(`Connecting to room ${code}…`);

    // Newer protocol: teacher:createRoom
    socket.emit(
      "teacher:createRoom",
      { roomCode: code },
      (ack) => {
        if (ack && ack.roomCode) {
          setStatus(`Room ${ack.roomCode} ready.`);
        } else {
          setStatus(`Room ${code} created (no ack).`);
        }
      }
    );

    // Legacy compatibility (if backend still has it)
    socket.emit("joinRoom", {
      roomCode: code,
      role: "teacher",
      name: "Teacher",
    });

    const handleRoomState = (state) => {
      if (!state) return;
      setRoomState((prev) => ({ ...prev, ...state }));
    };

    // Support both old and new event names
    socket.on("roomState", handleRoomState);
    socket.on("room:state", handleRoomState);
    socket.on("room:update", handleRoomState);

    socket.on("team:joined", (payload) => {
      // Some versions may emit the whole state, others just a team
      if (payload && (payload.teams || payload.stations)) {
        handleRoomState(payload);
      } else {
        // If only a single team is sent, ask backend to sync full room state
        socket.emit("teacher:syncRoom", { roomCode: code });
      }
    });

    return () => {
      socket.off("roomState", handleRoomState);
      socket.off("room:state", handleRoomState);
      socket.off("room:update", handleRoomState);
      socket.off("team:joined");
    };
  }, [roomCode]);

  // -------- Controls that drive backend behaviour --------

  const handleStartSession = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    // Old + new protocol names, in case only one exists
    socket.emit("startSession", { roomCode: code });
    socket.emit("teacher:startSession", { roomCode: code });

    setStatus(`Starting session in room ${code}… (assigning stations)`);
  };

  const handleNextTask = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("nextTask", { roomCode: code });
    socket.emit("teacher:nextTask", { roomCode: code });

    setStatus(`Moving to next task in room ${code}…`);
  };

  const handleEndSession = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("endSession", { roomCode: code });
    socket.emit("teacher:endSession", { roomCode: code });

    setStatus(`Session in room ${code} ended.`);
  };

  // -------- Helpers for UI --------

  const getStationForTeam = (team) => {
    if (!team) return { label: "Not assigned", color: null, id: null };

    const id =
      team.currentStationId ||
      team.stationId ||
      team.station ||
      null;

    if (!id) return { label: "Not assigned", color: null, id: null };

    // Try to find a station record in roomState.stations
    const match =
      stationsArray.find(
        (s) =>
          s.id === id ||
          s.stationId === id ||
          s.label === id
      ) || null;

    if (match) {
      return {
        id: match.id,
        label: match.label,
        color: match.color || null,
      };
    }

    // Fallback label from id
    let label = id;
    if (id.startsWith("station-")) {
      const tail = id.slice("station-".length);
      label = `Station-${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
    }

    return {
      id,
      label,
      color: null,
    };
  };

  const sortedTeams = useMemo(() => {
    if (!teamsArray.length) return [];
    const scores = roomState.scores || {};
    return [...teamsArray].sort((a, b) => {
      const sa = scores[a.teamId] ?? 0;
      const sb = scores[b.teamId] ?? 0;
      return sb - sa;
    });
  }, [teamsArray, roomState.scores]);

  const roomLabel = roomState.roomCode || roomCode || "—";

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Room view</h1>
      <p style={{ fontSize: "0.9rem", color: "#475569" }}>
        Room code: <strong>{roomLabel}</strong>
        <br />
        Status: {status}
      </p>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: teacher controls */}
        <div style={{ flex: "0 0 260px" }}>
          <h2 style={{ fontSize: "1rem", marginTop: 0 }}>
            Session controls
          </h2>
          <button
            type="button"
            onClick={handleStartSession}
            style={btnStyle}
          >
            Start session / assign stations
          </button>
          <button
            type="button"
            onClick={handleNextTask}
            style={{ ...btnStyle, marginTop: 8 }}
          >
            Next task
          </button>
          <button
            type="button"
            onClick={handleEndSession}
            style={{ ...btnStyle, marginTop: 8, background: "#b91c1c" }}
          >
            End session
          </button>

          <div
            style={{
              marginTop: 16,
              padding: 8,
              borderRadius: 8,
              background: "#f1f5f9",
              fontSize: "0.8rem",
              color: "#64748b",
            }}
          >
            <p style={{ marginTop: 0 }}>
              When you click <strong>Start session</strong>, the backend
              should assign each team a station / colour. If teams still say
              “waiting for station” on student devices, it means the backend
              has not yet set <code>currentStationId</code> for those teams.
            </p>
          </div>
        </div>

        {/* Right: layout / teams */}
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Teams & stations</h2>
          {sortedTeams.length === 0 ? (
            <p>No teams have joined this room yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {sortedTeams.map((team) => {
                const station = getStationForTeam(team);
                const pts =
                  (roomState.scores && roomState.scores[team.teamId]) || 0;

                return (
                  <div
                    key={team.teamId}
                    style={{
                      borderRadius: 10,
                      border: "1px solid #cbd5f5",
                      padding: 10,
                      background: "#ffffff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.95rem",
                          }}
                        >
                          {team.teamName || "Unnamed team"}
                        </div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#64748b",
                          }}
                        >
                          id: {team.teamId}
                        </div>
                      </div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.9rem",
                        }}
                      >
                        {pts} pts
                      </div>
                    </div>

                    {Array.isArray(team.members) && team.members.length > 0 && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#64748b",
                          marginBottom: 4,
                        }}
                      >
                        {team.members.join(", ")}
                      </div>
                    )}

                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "0.85rem",
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: "1px solid #cbd5e1",
                          background: station.color || "#e2e8f0",
                        }}
                      />
                      <div>
                        Station:{" "}
                        <strong>
                          {station.label || "Not assigned"}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h2 style={{ fontSize: "1rem", marginTop: 24 }}>Stations</h2>
          {stationsArray.length === 0 ? (
            <p>No stations are currently defined for this room.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 10,
              }}
            >
              {stationsArray.map((s) => (
                <div
                  key={s.id}
                  style={{
                    borderRadius: 8,
                    padding: 8,
                    textAlign: "center",
                    background: "#e2e8f0",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                  >
                    {s.label}
                  </div>
                  {s.color && (
                    <div
                      style={{
                        marginTop: 6,
                        width: 30,
                        height: 30,
                        borderRadius: 6,
                        marginInline: "auto",
                        border: "1px solid #cbd5e1",
                        background: s.color,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
 
const btnStyle = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "none",
  background: "#0ea5e9",
  color: "#ffffff",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
};
