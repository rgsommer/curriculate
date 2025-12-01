// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useState, useRef } from "react";
import { socket } from "../socket";

// Station colours in order: station-1 → red, station-2 → blue, etc.
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
  return idx >= 0 ? COLORS[idx] || null : null;
}

export default function LiveSession({ roomCode }) {
  const [status, setStatus] = useState("Checking connection…");
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
    locationCode: "Classroom",
    taskIndex: -1,
    treatsConfig: {
      enabled: true,
      total: 4,
      given: 0,
    },
    pendingTreatTeams: [],
    noise: {
      enabled: false,
      threshold: 0,
      level: 0,
      brightness: 1,
    },
  });

  const [submissions, setSubmissions] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);
  const [teamOrder, setTeamOrder] = useState([]);

  // Quick task fields
  const [prompt, setPrompt] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [isLaunchingQuick, setIsLaunchingQuick] = useState(false);

  // Active taskset meta
  const [activeTasksetMeta, setActiveTasksetMeta] = useState(() => {
    try {
      const raw = localStorage.getItem("curriculateActiveTasksetMeta");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  const [loadedTasksetId, setLoadedTasksetId] = useState(null);

  // "Launch immediately" flag coming from TaskSets via localStorage
  const [autoLaunchRequested, setAutoLaunchRequested] = useState(false);

  // When true, we have requested a taskset launch and are waiting for
  // "tasksetLoaded" before calling teacher:launchNextTask.
  const [launchAfterLoad, setLaunchAfterLoad] = useState(false);

    const activeTasksetName =
    activeTasksetMeta?.name ||
    activeTasksetMeta?.title ||
    activeTasksetMeta?.tasksetName ||
    "Untitled set";

  const totalTasksInActiveSet =
    (Array.isArray(activeTasksetMeta?.tasks) && activeTasksetMeta.tasks.length) ||
    (typeof activeTasksetMeta?.taskCount === "number" && activeTasksetMeta.taskCount > 0
      ? activeTasksetMeta.taskCount
      : null) ||
    (Array.isArray(activeTasksetMeta?.taskList) && activeTasksetMeta.taskList.length) ||
    null;

  // Room setup / fixed-station helper
  const [roomSetup, setRoomSetup] = useState(null);
  const [showRoomSetup, setShowRoomSetup] = useState(false);

  // End-session / email reports logic
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [endSessionMessage, setEndSessionMessage] = useState("");

  // Join & treat sounds
  const joinSoundRef = useRef(null);
  const treatSoundRef = useRef(null);

  // Noise-control local UI state
  const [noiseLevel, setNoiseLevel] = useState(0);
  const [noiseThreshold, setNoiseThreshold] = useState(0);
  const [noiseEnabled, setNoiseEnabled] = useState(false);
  const [noiseBrightness, setNoiseBrightness] = useState(1);

  // Treats UI state (mirrors roomState.treatsConfig)
  const [treatsConfig, setTreatsConfig] = useState({
    enabled: true,
    total: 4,
    given: 0,
  });

  const [isNarrow, setIsNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < 900 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 900);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const audio = new Audio("/sounds/join.mp3");
    audio.load();
    joinSoundRef.current = audio;

    const treatAudio = new Audio("/sounds/treat.mp3");
    treatAudio.load();
    treatSoundRef.current = treatAudio;
  }, []);

  // ----------------------------------------------------
  // Create the room + join it as teacher whenever roomCode changes
  // ----------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();
    setStatus("Connecting…");

    socket.emit("teacher:createRoom", { roomCode: code });

    socket.emit("joinRoom", {
      roomCode: code,
      name: "Teacher",
      role: "teacher",
    });

    setStatus("Connected.");
  }, [roomCode]);

  // On first mount, check if TaskSets asked us to auto-launch
  useEffect(() => {
    const flag = localStorage.getItem("curriculateLaunchImmediately");
    if (flag === "true") {
      localStorage.removeItem("curriculateLaunchImmediately");
      setAutoLaunchRequested(true);
    }
  }, []);

  // If auto-launch is requested, load the active taskset and then launch
  useEffect(() => {
    if (!autoLaunchRequested) return;
    if (!roomCode || !activeTasksetMeta?._id) return;

    const code = roomCode.toUpperCase();
    setStatus("Loading taskset…");

    // We don't rely on an ack here; the "tasksetLoaded" event will
    // actually trigger the launch via launchAfterLoad.
    setLaunchAfterLoad(true);
    socket.emit("loadTaskset", {
      roomCode: code,
      tasksetId: activeTasksetMeta._id,
    });

    setAutoLaunchRequested(false);
  }, [autoLaunchRequested, roomCode, activeTasksetMeta]);

  // ----------------------------------------------------
  // Socket listeners: keep room state + leaderboard in sync
  // ----------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;

    const handleRoom = (state) => {
      if (!state) return;

      setRoomState((prev) => ({
        ...prev,
        stations: state.stations || [],
        teams: state.teams || {},
        scores: state.scores || {},
        locationCode: state.locationCode || prev.locationCode || "Classroom",
        taskIndex:
          typeof state.taskIndex === "number"
            ? state.taskIndex
            : prev.taskIndex,
        treatsConfig: state.treatsConfig || prev.treatsConfig,
        pendingTreatTeams: state.pendingTreatTeams || [],
        noise: state.noise || prev.noise,
      }));

      const scores = state.scores || {};
      const teams = state.teams || {};
      const leaderboardArr = Object.entries(scores)
        .map(([teamId, score]) => ({
          teamId,
          score,
          name: teams[teamId]?.teamName || "Team",
        }))
        .sort((a, b) => b.score - a.score);
      setLeaderboard(leaderboardArr);

      const currentTeamIds = Object.keys(teams);
      setTeamOrder((prevOrder) => {
        const stillThere = prevOrder.filter((id) =>
          currentTeamIds.includes(id)
        );
        const newOnes = currentTeamIds.filter((id) => !stillThere.includes(id));
        return [...stillThere, ...newOnes];
      });

      if (state.treatsConfig) {
        setTreatsConfig((prevCfg) => ({
          ...prevCfg,
          ...state.treatsConfig,
        }));
      }

      if (state.noise) {
        setNoiseEnabled(!!state.noise.enabled);
        setNoiseThreshold(
          typeof state.noise.threshold === "number"
            ? state.noise.threshold
            : noiseThreshold
        );
        setNoiseLevel(
          typeof state.noise.level === "number"
            ? state.noise.level
            : noiseLevel
        );
        setNoiseBrightness(
          typeof state.noise.brightness === "number"
            ? state.noise.brightness
            : noiseBrightness
        );
      }
    };

    const handleTasksetLoaded = (payload) => {
      if (payload?.tasksetId) {
        setLoadedTasksetId(payload.tasksetId);
      }

      // If we requested a launch and the loaded taskset matches the
      // active one, immediately launch the first task.
      if (
        launchAfterLoad &&
        activeTasksetMeta &&
        payload?.tasksetId === activeTasksetMeta._id &&
        roomCode
      ) {
        const code = roomCode.toUpperCase();
        setStatus("Launching first task…");

        socket.emit("teacher:launchNextTask", { roomCode: code });
        setLaunchAfterLoad(false);
        setStatus("Taskset launched.");
      }
    };

    const handleSubmission = (submission) => {
      if (!submission) return;
      setSubmissions((prev) => ({
        ...prev,
        [submission.teamId || submission.team]: submission,
      }));
    };

    const handleTeamJoined = (data) => {
      const { teamId } = data || {};
      if (!teamId) return;

      setTeamOrder((prev) =>
        prev.includes(teamId) ? prev : [...prev, teamId]
      );

      if (joinSoundRef.current) {
        joinSoundRef.current.currentTime = 0;
        joinSoundRef.current.play().catch(() => {});
      }
    };

    const handleScanEvent = (event) => {
      if (!event) return;
      setScanEvents((prev) => [
        {
          ...event,
          timestamp: event.timestamp || Date.now(),
        },
        ...prev.slice(0, 199),
      ]);
    };

    const handleRoomSetup = (payload) => {
      setRoomSetup(payload || null);
    };

    const handleEndSessionAck = (payload) => {
      if (!payload) return;
      if (payload.ok) {
        setEndSessionMessage("Reports are being generated and emailed.");
      } else {
        setEndSessionMessage(
          payload.error ||
            "There was a problem generating or emailing the reports."
        );
      }
      setIsEndingSession(false);
    };

    const handleNoiseLevel = (payload) => {
      if (!payload) return;
      if (
        payload.roomCode &&
        roomCode &&
        payload.roomCode.toUpperCase() !== roomCode.toUpperCase()
      ) {
        return;
      }
      setNoiseLevel(
        typeof payload.level === "number" ? payload.level : noiseLevel
      );
      setNoiseBrightness(
        typeof payload.brightness === "number"
          ? payload.brightness
          : noiseBrightness
      );
      setNoiseEnabled(!!payload.enabled);
      if (typeof payload.threshold === "number") {
        setNoiseThreshold(payload.threshold);
      }
    };

    const handleTreatAssigned = (payload) => {
      console.log("[LiveSession] treat assigned:", payload);
      if (payload?.roomCode && roomCode) {
        if (payload.roomCode.toUpperCase() !== roomCode.toUpperCase()) {
          return;
        }
      }
      if (treatSoundRef.current) {
        treatSoundRef.current.currentTime = 0;
        treatSoundRef.current.play().catch(() => {});
      }
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("taskSubmission", handleSubmission);
    socket.on("teamJoined", handleTeamJoined);
    socket.on("scanEvent", handleScanEvent);
    socket.on("teacher:roomSetup", handleRoomSetup);
    socket.on("teacher:endSessionAndEmail:result", handleEndSessionAck);
    socket.on("session:noiseLevel", handleNoiseLevel);
    socket.on("teacher:treatAssigned", handleTreatAssigned);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("tasksetLoaded", handleTasksetLoaded);
      socket.off("taskSubmission", handleSubmission);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("scanEvent", handleScanEvent);
      socket.off("teacher:roomSetup", handleRoomSetup);
      socket.off("teacher:endSessionAndEmail:result", handleEndSessionAck);
      socket.off("session:noiseLevel", handleNoiseLevel);
      socket.off("teacher:treatAssigned", handleTreatAssigned);
    };
  }, [
    roomCode,
    noiseLevel,
    noiseBrightness,
    launchAfterLoad,
    activeTasksetMeta,
  ]);

  // ----------------------------------------------------
  // Actions
  // ----------------------------------------------------
  const handleSkipTask = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:skipNextTask", { roomCode: code });
  };

  const handleLaunchQuickTask = () => {
    if (!roomCode || !prompt.trim()) return;
    setIsLaunchingQuick(true);
    const code = roomCode.toUpperCase();

    socket.emit("teacherLaunchTask", {
      roomCode: code,
      prompt: prompt.trim(),
      correctAnswer: (correctAnswer || "").trim() || null,
    });

    setTimeout(() => {
      setIsLaunchingQuick(false);
      setPrompt("");
      setCorrectAnswer("");
      setStatus("Quick task launched.");
    }, 200);
  };

  const handleLaunchTaskset = () => {
    if (!roomCode || !activeTasksetMeta?._id) return;
    const code = roomCode.toUpperCase();

    setStatus("Loading taskset…");
    setLaunchAfterLoad(true);

    // Fire-and-forget; once the server finishes loading it will emit
    // "tasksetLoaded" and our listener will call teacher:launchNextTask.
    socket.emit("loadTaskset", {
      roomCode: code,
      tasksetId: activeTasksetMeta._id,
    });
  };

  const handleEndSessionAndEmail = () => {
    if (!roomCode || isEndingSession) return;
    const code = roomCode.toUpperCase();
    setIsEndingSession(true);
    setEndSessionMessage("");

    socket.emit("teacher:endSessionAndEmail", { roomCode: code });
  };

  const handleGiveTreat = () => {
    if (!roomCode || !canGiveTreat) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:giveTreat", { roomCode: code });
  };

  const handleToggleNoise = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    const nextEnabled = !noiseEnabled;

    socket.emit("teacher:setNoiseControl", {
      roomCode: code,
      enabled: nextEnabled,
      threshold: noiseThreshold,
    });

    setNoiseEnabled(nextEnabled);
  };

  const handleNoiseThresholdChange = (e) => {
    const value = Number(e.target.value) || 0;
    setNoiseThreshold(value);
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("teacher:setNoiseControl", {
      roomCode: code,
      enabled: noiseEnabled,
      threshold: value,
    });
  };

  // ----------------------------------------------------
  // Derived helpers + button state
  // ----------------------------------------------------
  const teams = roomState.teams || {};
  const teamIdsForGrid = teamOrder.filter((id) => teams[id]);
  const taskFlowActive =
    typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0;

  const canGiveTreat =
    treatsConfig.enabled &&
    (typeof treatsConfig.total === "number" &&
    typeof treatsConfig.given === "number"
      ? treatsConfig.given < treatsConfig.total
      : true);

  const pendingTreatTeams = roomState.pendingTreatTeams || [];

  const noiseLabel = !noiseEnabled
    ? "Off"
    : noiseThreshold < 40
    ? "Light"
    : noiseThreshold < 70
    ? "Moderate"
    : "Strict";

  // Launch button state machine
  let launchBtnLabel = "Launch from taskset";
  let launchBtnBg = "#10b981"; // green
  let launchBtnOnClick = handleLaunchTaskset;
  let launchBtnDisabled = !activeTasksetMeta;

  if (!activeTasksetMeta) {
    // No active set selected at all
    launchBtnDisabled = true;
    launchBtnBg = "#9ca3af";
    launchBtnLabel = "Launch from taskset";
    launchBtnOnClick = null;
  } else if (taskFlowActive) {
    // A task is in progress – turn into red END SESSION button
    launchBtnLabel = "End Task Session & Generate Reports";
    launchBtnBg = "#dc2626"; // red-600
    launchBtnOnClick = handleEndSessionAndEmail;
    launchBtnDisabled = isEndingSession;
  } else if (launchAfterLoad) {
    // We're in the middle of loading & launching
    launchBtnLabel = "Launching taskset…";
    launchBtnBg = "#10b981";
    launchBtnOnClick = null;
    launchBtnDisabled = true;
  }

  const renderTeamCard = (teamId) => {
    const team = teams[teamId];
    if (!team) return null;

    const score = roomState.scores?.[teamId] ?? 0;
    const currentStationId = team.currentStationId || null;
    const color = stationIdToColor(currentStationId);
    const isPendingTreat = pendingTreatTeams.includes(teamId);
    const lastScan =
      scanEvents.find((ev) => ev.teamId === teamId) || null;

    return (
      <div
        key={teamId}
        style={{
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 12,
          background: "#ffffff",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.95rem",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{team.teamName || "Team"}</span>
            {team.members && team.members.length > 0 && (
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "#6b7280",
                }}
              >
                ({team.members.join(", ")})
              </span>
            )}
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: "1.1rem",
              color: "#111827",
            }}
          >
            {score}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              border: "2px solid #e5e7eb",
              background: color || "#f9fafb",
              boxShadow: color
                ? `0 0 0 0 rgba(255,255,255,0.9)`
                : "none",
              animation: color ? "stationPulse 1.8s ease-out infinite" : "none",
            }}
          />
                    <div
            style={{
              fontSize: "0.8rem",
              color: "#4b5563",
            }}
          >
            {currentStationId ? (
              <>
                <span>{`Station ${currentStationId.toUpperCase()}`}</span>
                {color && (
                  <span style={{ marginLeft: 6 }}>
                    • {color.charAt(0).toUpperCase() + color.slice(1)} station
                  </span>
                )}
              </>
            ) : (
              "Waiting for station…"
            )}
            {typeof team.taskIndex === "number" && team.taskIndex >= 0 && (
              <span style={{ marginLeft: 6, color: "#1d4ed8" }}>
                · Task {team.taskIndex + 1}
                {typeof totalTasksInActiveSet === "number" &&
                totalTasksInActiveSet > 0
                  ? ` of ${totalTasksInActiveSet}`
                  : ""}
              </span>
            )}
          </div>
        </div>

        {lastScan && (
          <div
            style={{
              fontSize: "0.75rem",
              color: "#6b7280",
            }}
          >
            Last scan:{" "}
            <strong>
              {stationIdToColor(lastScan.stationId) ||
                lastScan.stationLabel ||
                lastScan.stationId ||
                "Unknown"}
            </strong>{" "}
            at{" "}
            {lastScan.timestamp
              ? new Date(lastScan.timestamp).toLocaleTimeString()
              : ""}
          </div>
        )}

        {isPendingTreat && (
          <div
            style={{
              marginTop: 6,
              padding: "4px 8px",
              borderRadius: 999,
              background: "#fef3c7",
              color: "#92400e",
              fontSize: "0.75rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            🍬 See teacher for a treat!
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: 8,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.25rem",
            }}
          >
            Live Session
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "#6b7280",
            }}
          >
            Room <strong>{roomCode}</strong> · {status}
          </p>
          {endSessionMessage && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "0.8rem",
                color: "#16a34a",
              }}
            >
              {endSessionMessage}
            </p>
          )}
        </div>
        {roomState.locationCode && (
          <div
            style={{
              fontSize: "0.85rem",
              padding: "4px 10px",
              borderRadius: 999,
              background: "#eff6ff",
              color: "#1d4ed8",
            }}
          >
            Location: {roomState.locationCode}
          </div>
        )}
      </header>

      {/* Top controls: quick task, taskset launch, noise/treats summary */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        {/* Quick task + taskset launch panel */}
        <div
          style={{
            flex: 1.5,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            padding: 12,
            background: "#ffffff",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: 8,
              fontSize: "0.9rem",
            }}
          >
            Task controls
          </div>

          {/* Quick task */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <label
              style={{
                fontSize: "0.8rem",
                color: "#374151",
              }}
            >
              Quick prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Ask something simple all teams can respond to…"
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                resize: "vertical",
                fontSize: "0.85rem",
              }}
            />
            <input
              type="text"
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              placeholder="Optional: correct answer (for auto-scoring)"
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 6,
                fontSize: "0.85rem",
              }}
            />
            <button
              type="button"
              onClick={handleLaunchQuickTask}
              style={{
                marginTop: 4,
                alignSelf: "flex-start",
                padding: "6px 10px",
                borderRadius: 999,
                border: "none",
                background: "#0ea5e9",
                color: "#ffffff",
                fontSize: "0.8rem",
                cursor:
                  isLaunchingQuick || taskFlowActive
                    ? "not-allowed"
                    : "pointer",
                opacity: isLaunchingQuick || taskFlowActive ? 0.5 : 1,
              }}
              disabled={isLaunchingQuick || taskFlowActive}
            >
              {isLaunchingQuick ? "Launching…" : "Launch quick task"}
            </button>
          </div>

          {/* Taskset launch + skip */}
          <div
            style={{
              marginTop: 8,
              borderTop: "1px solid #f3f4f6",
              paddingTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.8rem",
              }}
            >
              <span style={{ fontWeight: 600 }}>Taskset</span>
              {activeTasksetMeta ? (
                <span style={{ color: "#6b7280" }}>
                  Active: <strong>{activeTasksetName}</strong>
                </span>
              ) : (
                <span style={{ color: "#9ca3af" }}>
                  No active taskset selected.
                </span>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={launchBtnOnClick || undefined}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: launchBtnBg,
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  cursor: launchBtnDisabled ? "not-allowed" : "pointer",
                  opacity: launchBtnDisabled ? 0.5 : 1,
                }}
                disabled={launchBtnDisabled}
              >
                {launchBtnLabel}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleSkipTask}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: "#6b7280",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  cursor: taskFlowActive ? "pointer" : "not-allowed",
                  opacity: taskFlowActive ? 1 : 0.4,
                }}
                disabled={!taskFlowActive}
              >
                Skip current task
              </button>
            </div>
          </div>
        </div>

        {/* Noise + treats summary / controls */}
        <div
          style={{
            flex: 1,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            padding: 12,
            background: "#ffffff",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Noise */}
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.9rem",
                marginBottom: 4,
              }}
            >
              Noise control
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.8rem",
                marginBottom: 4,
              }}
            >
              <span>Mode: {noiseLabel}</span>
              <button
                type="button"
                onClick={handleToggleNoise}
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "none",
                  background: noiseEnabled ? "#22c55e" : "#e5e7eb",
                  color: noiseEnabled ? "#ffffff" : "#374151",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                {noiseEnabled ? "Disable" : "Enable"}
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={noiseThreshold}
              onChange={handleNoiseThresholdChange}
              style={{ width: "100%" }}
            />
            <div
              style={{
                fontSize: "0.75rem",
                color: "#6b7280",
                marginTop: 2,
              }}
            >
              Live level: {noiseLevel} · Brightness factor:{" "}
              {noiseEnabled ? noiseBrightness.toFixed(2) : "1.00"}
            </div>
          </div>

          {/* Treats */}
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.9rem",
                marginBottom: 4,
              }}
            >
              Treats
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                marginBottom: 4,
              }}
            >
              {treatsConfig.enabled ? (
                <>
                  {treatsConfig.given} / {treatsConfig.total} treats given.
                </>
              ) : (
                <>Treats disabled.</>
              )}
            </div>
            <button
              type="button"
              onClick={handleGiveTreat}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "none",
                background: "#f97316",
                color: "#ffffff",
                fontSize: "0.8rem",
                cursor: canGiveTreat ? "pointer" : "not-allowed",
                opacity: canGiveTreat ? 1 : 0.5,
              }}
              disabled={!canGiveTreat}
            >
              Give random treat
            </button>
          </div>
        </div>
      </div>

      {/* Main body: teams + leaderboard + scan log */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          minHeight: 0,
          flexDirection: isNarrow ? "column" : "row",
        }}
      >
        {/* Teams grid */}
        <div style={{ flex: 3, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Teams</h2>
          {teamIdsForGrid.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No teams yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(180px, 1fr))",
                minHeight: 120,
                gap: 12,
                width: "100%",
              }}
            >
              {teamIdsForGrid.map((teamId) => renderTeamCard(teamId))}
            </div>
          )}
        </div>

        {/* Right column: leaderboard + scan log */}
        <div
          style={{
            flex: isNarrow ? "none" : 1.2,
            minWidth: isNarrow ? "100%" : 260,
            borderLeft: isNarrow ? "none" : "1px solid #e5e7eb",
            borderTop: isNarrow ? "1px solid #e5e7eb" : "none",
            paddingLeft: isNarrow ? 0 : 12,
            paddingTop: isNarrow ? 12 : 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Leaderboard */}
          <section
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 12,
              background: "#ffffff",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 10,
                fontSize: "1.1rem",
                fontWeight: 600,
              }}
            >
              Leaderboard
            </h2>

            <div style={{ fontSize: "0.9rem", color: "#4b5563" }}>
              {leaderboard.length > 0 ? (
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {leaderboard.map((team, idx) => (
                    <li key={team.teamId} style={{ marginBottom: 4 }}>
                      <strong>{idx + 1}.</strong>{" "}
                      {teams[team.teamId]?.teamName || team.name} —{" "}
                      {team.score} pts
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No scores yet.</p>
              )}
            </div>
          </section>

          {/* Scan log – fixed height with scroll */}
          <section
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 12,
              background: "#ffffff",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "1.1rem",
                fontWeight: 600,
              }}
            >
              Scan log
            </h2>

            <div
              style={{
                maxHeight: 200,
                overflowY: "auto",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                padding: "6px 8px",
                background: "#f9fafb",
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              {scanEvents.length === 0 ? (
                <p style={{ margin: 0, color: "#9ca3af" }}>
                  No scans yet.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    paddingLeft: 0,
                    margin: 0,
                  }}
                >
                  {scanEvents.map((entry, idx) => {
                    const teamName =
                      entry.teamName ||
                      teams[entry.teamId]?.teamName ||
                      "Team";
                    const station =
                      entry.stationLabel ||
                      stationIdToColor(entry.stationId) ||
                      entry.stationId ||
                      "a station";
                    const time = entry.timestamp
                      ? new Date(entry.timestamp).toLocaleTimeString()
                      : "";

                    return (
                      <li
                        key={entry.id || `${entry.teamId}-${idx}`}
                        style={{
                          padding: "4px 0",
                          borderBottom:
                            idx === scanEvents.length - 1
                              ? "none"
                              : "1px solid #e5e7eb",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span>
                          <strong>{teamName}</strong> scanned{" "}
                          <span style={{ fontWeight: 500 }}>
                            {station}
                          </span>
                        </span>
                        {time && (
                          <span
                            style={{
                              color: "#9ca3af",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {time}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Optional: Room setup overlay for fixed-station sets */}
      {showRoomSetup && roomSetup && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowRoomSetup(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 12,
              padding: 16,
              minWidth: 400,
              maxWidth: "80vw",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Room setup</h2>
            <p style={{ fontSize: "0.9rem", color: "#4b5563" }}>
              Classroom layout with station bubbles and their required
              equipment.
            </p>
            <div
              style={{
                marginTop: 12,
                borderRadius: 8,
                border: "2px dashed #93c5fd",
                height: 240,
                position: "relative",
                background: "#eff6ff",
              }}
            >
              {(roomSetup.stations || []).map((s, idx) => {
                const angle =
                  (2 * Math.PI * idx) /
                  Math.max(1, roomSetup.stations.length);
                const cx = 50 + 40 * Math.cos(angle);
                const cy = 50 + 40 * Math.sin(angle);
                return (
                  <div
                    key={s.id || idx}
                    style={{
                      position: "absolute",
                      left: `${cx}%`,
                      top: `${cy}%`,
                      transform: "translate(-50%, -50%)",
                      padding: "4px 6px",
                      borderRadius: 999,
                      background: "#ffffff",
                      border: "1px solid #3b82f6",
                      fontSize: "0.75rem",
                    }}
                  >
                    {s.label || s.id}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowRoomSetup(false)}
              style={{
                marginTop: 12,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                background: "#f9fafb",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
