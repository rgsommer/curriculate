// teacher-app/src/pages/HostView.jsx
// Drop-in projector/host view: Teams list + Leaderboard only (no side column UI).
// NOTE: Layout/sidebar suppression is done at the router/layout level. This file is intentionally full-bleed.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";

export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    teams: {},
    scores: {},
    taskIndex: -1,
    locationCode: "Classroom",
  });

  const joinSoundRef = useRef(null);

  useEffect(() => {
    const audio = new Audio("/sounds/join.mp3");
    audio.load();
    joinSoundRef.current = audio;
  }, []);

  // Best-effort unlock on first click so join sounds can play
  useEffect(() => {
    const unlock = () => {
      const a = joinSoundRef.current;
      if (!a) return;
      a.muted = true;
      a.play()
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

  // Join as host
  useEffect(() => {
    if (!roomCode) return;
    const code = String(roomCode).toUpperCase().trim();
    if (!code) return;

    socket.emit("joinRoom", { roomCode: code, role: "host", name: "Host" });
  }, [roomCode]);

  useEffect(() => {
    const handleRoom = (state) => {
      const safe = state || {};
      setRoomState((prev) => ({
        ...prev,
        teams: safe.teams || {},
        scores: safe.scores || {},
        locationCode: safe.locationCode || safe.locationCode === "" ? safe.locationCode : (prev.locationCode || "Classroom"),
        taskIndex: typeof safe.taskIndex === "number" ? safe.taskIndex : prev.taskIndex,
      }));
    };

    const handleTeamJoined = () => {
      const a = joinSoundRef.current;
      if (!a) return;
      a.currentTime = 0;
      a.play().catch(() => {});
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);

    // Back-compat events
    socket.on("teamJoined", handleTeamJoined);
    socket.on("team:joined", handleTeamJoined);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("team:joined", handleTeamJoined);
    };
  }, []);

  const teamsObj = roomState.teams || {};
  const scoresObj = roomState.scores || {};

  const teams = useMemo(() => Object.values(teamsObj || {}), [teamsObj]);

  const leaderboard = useMemo(() => {
    const rows = Object.entries(scoresObj || {}).map(([teamId, pts]) => ({
      teamId,
      pts: typeof pts === "number" ? pts : 0,
      name: teamsObj?.[teamId]?.teamName || teamsObj?.[teamId]?.name || teamId,
    }));
    rows.sort((a, b) => b.pts - a.pts);
    return rows;
  }, [scoresObj, teamsObj]);

  const code = (roomCode || "").toString().toUpperCase();

  const styles = {
    page: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0b1220, #0a2a3a)",
      color: "#f8fafc",
      padding: 24,
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    shell: { maxWidth: 1400, margin: "0 auto" },
    header: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 16,
      padding: "14px 16px",
      borderRadius: 16,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.10)",
      backdropFilter: "blur(6px)",
    },
    title: { fontSize: 28, fontWeight: 900, letterSpacing: 0.2, margin: 0 },
    subtitle: { fontSize: 13, opacity: 0.85, marginTop: 4 },
    pills: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },
    pill: {
      fontSize: 13,
      padding: "6px 10px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.10)",
      border: "1px solid rgba(255,255,255,0.14)",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
      gap: 14,
      alignItems: "start",
    },
    card: {
      borderRadius: 16,
      padding: 14,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.10)",
      backdropFilter: "blur(6px)",
    },
    cardTitle: { margin: 0, marginBottom: 10, fontSize: 16, fontWeight: 900 },
    muted: { opacity: 0.8, fontSize: 13 },
    teamTile: {
      borderRadius: 14,
      padding: 12,
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.10)",
    },
    teamName: { fontSize: 16, fontWeight: 900, marginBottom: 4 },
    teamMeta: { fontSize: 13, opacity: 0.86, lineHeight: 1.25 },
    mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    ol: { margin: 0, paddingLeft: 22 },
    li: { marginBottom: 10, fontSize: 16 },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Curriculate Host View</h1>
            <div style={styles.subtitle}>
              Room <span style={styles.mono}>{code || "—"}</span>
              {" • "}
              {roomState.locationCode || "Classroom"}
              {" • "}
              Task{" "}
              <span style={styles.mono}>
                {typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
                  ? roomState.taskIndex + 1
                  : "—"}
              </span>
            </div>
          </div>

          <div style={styles.pills}>
            <div style={styles.pill}>
              Teams: <strong>{teams.length}</strong>
            </div>
            <div style={styles.pill}>
              Leaderboard: <strong>{leaderboard.length}</strong>
            </div>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Teams</h2>
            {teams.length === 0 ? (
              <div style={styles.muted}>No teams joined yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {teams
                  .slice()
                  .sort((a, b) =>
                    String(a.teamName || a.name || "").localeCompare(String(b.teamName || b.name || ""))
                  )
                  .map((t) => {
                    const id = t.teamId || t.id || t._id || "";
                    const name = t.teamName || t.name || id || "Team";
                    const members = Array.isArray(t.members) ? t.members : [];
                    return (
                      <div key={id || name} style={styles.teamTile}>
                        <div style={styles.teamName}>{name}</div>
                        {members.length > 0 && (
                          <div style={styles.teamMeta}>{members.join(", ")}</div>
                        )}
                        <div style={styles.teamMeta}>
                          Station:{" "}
                          <span style={styles.mono}>
                            {t.currentStationId || t.station || "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Leaderboard</h2>
            {leaderboard.length === 0 ? (
              <div style={styles.muted}>No scores yet.</div>
            ) : (
              <ol style={styles.ol}>
                {leaderboard.map((row, i) => (
                  <li key={row.teamId} style={styles.li}>
                    <span style={{ fontWeight: 900 }}>{i + 1}.</span>{" "}
                    <span style={{ fontWeight: 800 }}>{row.name}</span>{" "}
                    <span style={{ opacity: 0.8 }}>—</span>{" "}
                    <span style={{ fontWeight: 900 }}>{row.pts}</span>{" "}
                    <span style={{ opacity: 0.8 }}>pts</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
