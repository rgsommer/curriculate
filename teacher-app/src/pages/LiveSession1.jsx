// teacher-app/src/pages/LiveSession.jsx
// COMPLETE DROP-IN REPLACEMENT
// ------------------------------------------------------------
// Includes:
// • Team status bubble logic
// • Join sound that works reliably
// • “Awaiting task response” after launch
// • “Timed out” status support
// • Uses locationCode from backend
// ------------------------------------------------------------

import React, { useEffect, useState, useRef } from "react";
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

export default function LiveSession({ roomCode }) {
  const [status, setStatus] = useState("Checking connection…");
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
    locationCode: "Classroom",
    taskIndex: null,
  });

  const [submissions, setSubmissions] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);

  const [loadedTasksetId, setLoadedTasksetId] = useState(null);
  const [activeTasksetMeta, setActiveTasksetMeta] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("curriculateActiveTasksetMeta")
      );
    } catch {
      return null;
    }
  });

  const [autoLaunchRequested, setAutoLaunchRequested] = useState(false);

  const joinSound = useRef(null);

  // ------------------------------------------------------------
  // Load audio on mount
  // ------------------------------------------------------------
  useEffect(() => {
    const audio = new Audio("/join.mp3");
    audio.load();
    joinSound.current = audio;
  }, []);

  // Prime audio on first click so autoplay is allowed
  useEffect(() => {
    const unlock = () => {
      const a = joinSound.current;
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
  // Join room with teacher role
  // ------------------------------------------------------------
  useEffect(() => {
    if (!roomCode) {
      setStatus("No room code.");
      return;
    }

    const code = roomCode.toUpperCase();
    socket.emit("teacher:createRoom", { roomCode: code });
    socket.emit("joinRoom", {
      roomCode: code,
      name: "Teacher",
      role: "teacher",
    });

    setStatus("Connected.");
  }, [roomCode]);

  // Auto-launch after redirect from TaskSets
  useEffect(() => {
    const flag = localStorage.getItem("curriculateLaunchImmediately");
    if (flag === "true") {
      localStorage.removeItem("curriculateLaunchImmediately");
      setAutoLaunchRequested(true);
    }
  }, []);

  useEffect(() => {
    if (!autoLaunchRequested) return;
    if (!activeTasksetMeta?._id) return;

    const code = roomCode.toUpperCase();

    if (loadedTasksetId !== activeTasksetMeta._id) {
      socket.emit("loadTaskset", {
        roomCode: code,
        tasksetId: activeTasksetMeta._id,
      });
      return;
    }

    socket.emit("launchTaskset", { roomCode: code });
    setAutoLaunchRequested(false);
  }, [autoLaunchRequested, activeTasksetMeta, loadedTasksetId, roomCode]);

  // ------------------------------------------------------------
  // Socket events
  // ------------------------------------------------------------
  useEffect(() => {
    const onRoomState = (state) => {
      const safe = state || {
        stations: [],
        teams: {},
        scores: {},
        locationCode: "Classroom",
        taskIndex: null,
      };
      setRoomState(safe);

      const scores = safe.scores || {};
      const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      setLeaderboard(sorted);
    };

    const onScanEvent = (payload) => {
      setScanEvents((prev) => [payload, ...prev].slice(0, 20));
    };

    const onTaskSubmission = (p) => {
      setSubmissions((prev) => ({ ...prev, [p.teamId]: p }));
    };

    const onLoaded = (info) => {
      if (!info?.tasksetId) return;
      setLoadedTasksetId(info.tasksetId);
      const meta = {
        _id: info.tasksetId,
        name: info.name,
        numTasks: info.numTasks,
      };
      setActiveTasksetMeta(meta);
      localStorage.setItem(
        "curriculateActiveTasksetMeta",
        JSON.stringify(meta)
      );
    };

    const onTeamJoined = () => {
      const a = joinSound.current;
      if (a) {
        a.currentTime = 0;
        a.play().catch(() => {});
      }
    };

    socket.on("room:state", onRoomState);
    socket.on("scanEvent", onScanEvent);
    socket.on("taskSubmission", onTaskSubmission);
    socket.on("tasksetLoaded", onLoaded);
    socket.on("team:joined", onTeamJoined);

    return () => {
      socket.off("room:state", onRoomState);
      socket.off("scanEvent", onScanEvent);
      socket.off("taskSubmission", onTaskSubmission);
      socket.off("tasksetLoaded", onLoaded);
      socket.off("team:joined", onTeamJoined);
    };
  }, []);

  // ------------------------------------------------------------
  // Launch taskset
  // ------------------------------------------------------------
  const launchFromTaskset = () => {
    const code = roomCode.toUpperCase();

    if (!activeTasksetMeta?._id) {
      alert(
        'No active task set selected.\nGo to Task Sets and click "Use in Live Session".'
      );
      return;
    }

    if (loadedTasksetId !== activeTasksetMeta._id) {
      socket.emit("loadTaskset", {
        roomCode: code,
        tasksetId: activeTasksetMeta._id,
      });
      alert("Taskset loaded. Tap again to launch the first task.");
      return;
    }

    socket.emit("launchTaskset", { roomCode: code });
  };

  // ------------------------------------------------------------
  // Render station card
  // ------------------------------------------------------------
  const renderStationCard = (station) => {
    const team = roomState.teams[station.assignedTeamId];
    if (!team) {
      return (
        <div
          key={station.id}
          style={{
            borderRadius: 12,
            border: "1px dashed #cbd5f5",
            padding: 12,
            minWidth: 180,
            minHeight: 90,
            background: "#f9fafb",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            {station.id}
          </div>
          <div style={{ color: "#9ca3af" }}>No team yet</div>
        </div>
      );
    }

    const latest = submissions[team.teamId];
    const color = stationIdToColor(team.currentStationId);
    const scanned = team.lastScannedStationId === team.currentStationId;

    const isCurrentTask =
      latest?.taskIndex === roomState.taskIndex && latest != null;
    const timedOut =
      latest?.answerText === "" &&
      latest?.timeMs != null &&
      latest.taskIndex === roomState.taskIndex;

    // Determine status text
    let statusLine = "";
    if (!scanned) statusLine = "Waiting for a scan…";
    else if (scanned && roomState.taskIndex < 0) statusLine = "Scanned and ready";
    else if (scanned && !isCurrentTask && !timedOut)
      statusLine = "Awaiting task response";
    else if (isCurrentTask) statusLine = "Answer submitted";
    else if (timedOut) statusLine = "Timed out";

    const score = roomState.scores?.[team.teamId] ?? 0;

    return (
      <div
        key={station.id}
        style={{
          borderRadius: 12,
          padding: 12,
          minWidth: 200,
          minHeight: 110,
          background: color ? color : "#f9fafb",
          color: color ? "#fff" : "#111",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              opacity: 0.9,
              textTransform: "uppercase",
            }}
          >
            {station.id}
          </div>
          <div style={{ fontWeight: 600 }}>{team.teamName}</div>
          <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>{statusLine}</div>
        </div>

        <div style={{ fontSize: "0.85rem" }}>Score: {score}</div>
      </div>
    );
  };

  // ------------------------------------------------------------
  // MAIN RENDER
  // ------------------------------------------------------------
  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Live Session</h1>
      <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{status}</div>

      {activeTasksetMeta && (
        <div style={{ marginTop: 4, fontSize: "0.85rem" }}>
          Active Task Set: <strong>{activeTasksetMeta.name}</strong>
        </div>
      )}

      <button
        onClick={launchFromTaskset}
        style={{
          marginTop: 12,
          padding: "8px 16px",
          borderRadius: 6,
          border: "1px solid #0ea5e9",
          background: "#0ea5e9",
          color: "white",
          cursor: "pointer",
        }}
      >
        Launch from taskset
      </button>

      <div
        style={{
          marginTop: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {roomState.stations &&
          Object.values(roomState.stations).map((s) =>
            renderStationCard(s)
          )}
      </div>
    </div>
  );
}
