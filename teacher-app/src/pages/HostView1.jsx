// teacher-app/src/pages/HostView.jsx
// COMPLETE DROP-IN REPLACEMENT
// ------------------------------------------------------------
// Host / Projector View
// • Shows stations, team names, colours
// • Plays join sound reliably (primed on first click)
// • Updates on room:state, taskSubmission, scanEvent
// • Read-only version of LiveSession, simplified visuals
// ------------------------------------------------------------

import React, { useEffect, useRef, useState } from "react";
import { socket } from "../socket";

const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
];

function stationIdToColor(id) {
  const m = /^station-(\d+)$/.exec(id || "");
  const idx = m ? parseInt(m[1], 10) - 1 : -1;
  return idx >= 0 ? COLORS[idx] : null;
}

export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    stations: {},
    teams: {},
    scores: {},
    taskIndex: -1,
    locationCode: "Classroom",
  });

  const [submissions, setSubmissions] = useState({});
  const joinSoundRef = useRef(null);

  // ------------------------------------------------------------
  // Load join sound + unlock it on first click
  // ------------------------------------------------------------
  useEffect(() => {
    const audio = new Audio("/join.mp3");
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
      });
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);

  // ------------------------------------------------------------
  // Join as host view
  // ------------------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();
    socket.emit("joinRoom", { roomCode: code, role: "host", name: "Host" });
  }, [roomCode]);

  // ------------------------------------------------------------
  // Socket event handlers
  // ------------------------------------------------------------
  useEffect(() => {
    const onRoomState = (state) => {
      setRoomState(state || {});
    };

    const onSubmission = (p) => {
      setSubmissions((prev) => ({ ...prev, [p.teamId]: p }));
    };

    const onScanEvent = () => {};

    const onTeamJoined = () => {
      const a = joinSoundRef.current;
      if (a) {
        a.currentTime = 0;
        a.play().catch(() => {});
      }
    };

    socket.on("room:state", onRoomState);
    socket.on("taskSubmission", onSubmission);
    socket.on("scanEvent", onScanEvent);
    socket.on("team:joined", onTeamJoined);

    return () => {
      socket.off("room:state", onRoomState);
      socket.off("taskSubmission", onSubmission);
      socket.off("scanEvent", onScanEvent);
      socket.off("team:joined", onTeamJoined);
    };
  }, []);

  // ------------------------------------------------------------
  // Render station block
  // ------------------------------------------------------------
  const renderStation = (station) => {
    const team = roomState.teams[station.assignedTeamId];
    const color = stationIdToColor(team?.currentStationId);
    const score = roomState.scores?.[team?.teamId] ?? 0;

    return (
      <div
        key={station.id}
        style={{
          borderRadius: 12,
          padding: 16,
          minWidth: 220,
          minHeight: 140,
          background: color || "#f3f4f6",
          color: color ? "white" : "#111",
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              textTransform: "uppercase",
              fontSize: "0.75rem",
              opacity: 0.9,
            }}
          >
            {station.id}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
            {team ? team.teamName : "—"}
          </div>
        </div>

        {team && (
          <div style={{ fontSize: "1rem" }}>
            Score: <strong>{score}</strong>
          </div>
        )}
      </div>
    );
  };

  const stations = roomState.stations || {};

  // ------------------------------------------------------------
  // MAIN RENDER
  // ------------------------------------------------------------
  return (
    <div
      style={{
        padding: 24,
        width: "100%",
        minHeight: "100vh",
        background: "#0b1120",
        color: "white",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Host / Projector View</h1>
      <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
        Room: <strong>{roomCode}</strong> · Location:{" "}
        <strong>{roomState.locationCode}</strong>
      </div>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {Object.values(stations).map((s) => renderStation(s))}
      </div>
    </div>
  );
}
