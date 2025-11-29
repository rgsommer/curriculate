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
  const [autoLaunchRequested, setAutoLaunchRequested] = useState(false);

  // Room setup / fixed-station helper
  const [roomSetup, setRoomSetup] = useState(null);
  const [showRoomSetup, setShowRoomSetup] = useState(false);

  // End-session / email reports UI
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

    // Join that room as the teacher so we receive room:state updates
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

  // If auto-launch is requested, load + launch the active taskset
  useEffect(() => {
    if (!autoLaunchRequested) return;
    if (!roomCode || !activeTasksetMeta?._id) return;

    const code = roomCode.toUpperCase();

    // If the correct taskset isn't loaded yet, load it first.
    if (loadedTasksetId !== activeTasksetMeta._id) {
      socket.emit("loadTaskset", {
        roomCode: code,
        tasksetId: activeTasksetMeta._id,
      });
      // When the backend emits "tasksetLoaded", loadedTasksetId will update
      // and this effect will run again.
      return;
    }

    // At this point, the correct taskset is loaded in this room — launch it.
    socket.emit("launchTaskset", { roomCode: code });
    setAutoLaunchRequested(false);
  }, [autoLaunchRequested, roomCode, activeTasksetMeta, loadedTasksetId]);

  // ----------------------------------------------------
  // Socket listeners
  // ----------------------------------------------------
  useEffect(() => {
    const handleRoom = (state) => {
      console.log("[LiveSession] room state received:", state);
      const safe =
        state || {
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
        };
      setRoomState(safe);

      // Mirror noise state to local UI
      const noise = safe.noise || {};
      setNoiseLevel(typeof noise.level === "number" ? noise.level : 0);
      setNoiseThreshold(typeof noise.threshold === "number" ? noise.threshold : 0);
      setNoiseEnabled(!!noise.enabled);
      setNoiseBrightness(
        typeof noise.brightness === "number" ? noise.brightness : 1
      );

      const tCfg = safe.treatsConfig || {};
      setTreatsConfig({
        enabled: tCfg.enabled ?? true,
        total:
          typeof tCfg.total === "number" && !Number.isNaN(tCfg.total)
            ? tCfg.total
            : 4,
        given:
          typeof tCfg.given === "number" && !Number.isNaN(tCfg.given)
            ? tCfg.given
            : 0,
      });

      // Maintain a stable team order based on first join time.
      setTeamOrder((prev) => {
        const next = [...prev];
        const seen = new Set(next);
        Object.keys(safe.teams || {}).forEach((teamId) => {
          if (!seen.has(teamId)) {
            next.push(teamId);
            seen.add(teamId);
          }
        });
        // Drop teams that no longer exist in roomState
        return next.filter((id) => !!safe.teams[id]);
      });

      const entries = Object.entries(safe.scores || {}).sort(
        (a, b) => b[1] - a[1]
      );
      setLeaderboard(entries);
    };

    const handleTasksetLoaded = (info) => {
      console.log("Taskset loaded:", info);
      if (info && info.tasksetId) {
        setLoadedTasksetId(info.tasksetId);
        setActiveTasksetMeta((prev) => {
          const meta = {
            _id: info.tasksetId,
            name: info.name || prev?.name || "Loaded Taskset",
            numTasks: info.numTasks ?? prev?.numTasks ?? 0,
          };
          localStorage.setItem("curriculateActiveTasksetId", meta._id);
          localStorage.setItem(
            "curriculateActiveTasksetMeta",
            JSON.stringify(meta)
          );
          return meta;
        });
      }
    };

    const handleSubmission = (sub) => {
      if (!sub?.teamId) return;
      setSubmissions((prev) => ({
        ...prev,
        [sub.teamId]: sub,
      }));
    };

    const handleScanEvent = (ev) => {
      // ev: { roomCode, teamId, teamName, stationId, timestamp }
      setScanEvents((prev) => {
        const next = [ev, ...prev];
        return next.slice(0, 30); // keep last 30
      });
    };

    const handleTeamJoined = (info) => {
      console.log("[LiveSession] team joined:", info);
      if (joinSoundRef.current) {
        joinSoundRef.current.currentTime = 0;
        joinSoundRef.current.play().catch(() => {});
      }
    };

    const handleRoomSetup = (payload) => {
      // room setup info for fixed-station tasksets
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
      // Room state with pendingTreatTeams will arrive via room:state;
      // we just play the sound here.
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
  }, [roomCode, noiseLevel, noiseBrightness]);

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

    socket.emit(
      "teacher:launchQuickTask",
      {
        roomCode: code,
        prompt: prompt.trim(),
        correctAnswer: correctAnswer.trim() || null,
      },
      (ack) => {
        setIsLaunchingQuick(false);
        if (!ack || !ack.ok) {
          console.error("Quick task launch failed:", ack);
          setStatus("Quick task launch failed.");
        } else {
          setStatus("Quick task launched.");
        }
      }
    );
  };

  const handleLaunchTaskset = () => {
    if (!roomCode || !activeTasksetMeta?._id) return;
    const code = roomCode.toUpperCase();
    socket.emit("launchTaskset", { roomCode: code });
  };

  const handleRequestRoomSetup = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:getRoomSetup", { roomCode: code });
    setShowRoomSetup(true);
  };

  const handleEndSessionAndEmail = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    setIsEndingSession(true);
    setEndSessionMessage("");

    socket.emit("teacher:endSessionAndEmail", {
      roomCode: code,
    });
  };

  const handleNoiseSliderChange = (e) => {
    const value = Number(e.target.value) || 0;
    setNoiseThreshold(value);
    const enabled = value > 0;
    setNoiseEnabled(enabled);

    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:updateNoiseControl", {
      roomCode: code,
      enabled,
      threshold: value,
    });
  };

  const handleToggleTreatsEnabled = (e) => {
    const enabled = e.target.checked;
    const next = { ...treatsConfig, enabled };
    setTreatsConfig(next);

    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:updateTreatsConfig", {
      roomCode: code,
      enabled,
      totalTreats: next.total,
    });
  };

  const handleTreatsTotalChange = (e) => {
    const raw = e.target.value;
    const parsed = Number(raw);
    const cleanTotal = Number.isNaN(parsed) ? 0 : Math.max(0, Math.floor(parsed));

    const next = { ...treatsConfig, total: cleanTotal };
    setTreatsConfig(next);

    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:updateTreatsConfig", {
      roomCode: code,
      enabled: next.enabled,
      totalTreats: cleanTotal,
    });
  };

  // ----------------------------------------------------
  // Derived helpers + ordering rule
  // ----------------------------------------------------
  // Is there an active task running for this room right now?
  const taskFlowActive =
    typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0;

  const stationsRaw = Array.isArray(roomState.stations)
    ? roomState.stations
    : Object.values(roomState.stations || {});

  const teamsById = roomState.teams || {};
  const scores = roomState.scores || {};

  const pendingTreatTeams = Array.isArray(roomState.pendingTreatTeams)
    ? roomState.pendingTreatTeams
    : [];

  // This should eventually be supplied by backend when the active taskset
  // is fixed-station; if absent, it behaves as non-fixed.
  const isFixedStationTaskset = !!roomState.isFixedStationTaskset;

  const allTeamIds = Object.keys(teamsById);

  // Join-order baseline (fallback to object order if we don't yet have a history)
  const joinedOrder =
    teamOrder.length > 0
      ? teamOrder.filter((id) => !!teamsById[id])
      : allTeamIds;

  let teamIdsForGrid = joinedOrder;

  // If this is a fixed-station taskset, order the teams by station id:
  // station-1’s team first, then station-2, etc. Any unassigned teams
  // are appended later in join order.
  if (isFixedStationTaskset && stationsRaw.length > 0) {
    const sortedStations = [...stationsRaw].sort((a, b) =>
      String(a.id || "").localeCompare(String(b.id || ""))
    );
    const seen = new Set();
    const ordered = [];

    sortedStations.forEach((st) => {
      const teamId = st.assignedTeamId;
      if (teamId && teamsById[teamId] && !seen.has(teamId)) {
        ordered.push(teamId);
        seen.add(teamId);
      }
    });

    joinedOrder.forEach((id) => {
      if (!seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    });

    teamIdsForGrid = ordered;
  }

  // Keep a stations array around in case you still want station-based UI
  let stations = stationsRaw;
  if (stations.length === 0 && allTeamIds.length > 0) {
    stations = allTeamIds.map((teamId, index) => ({
      id: `Team ${index + 1}`,
      assignedTeamId: teamId,
    }));
  }

  const renderStationCard = (station) => {
    const team = teamsById[station.assignedTeamId] || null;
    const stationId = station.id;

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
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 4,
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#6b7280",
            }}
          >
            {station.id}
          </div>
          <div style={{ color: "#9ca3af" }}>No team yet</div>
        </div>
      );
    }

    const latest = submissions[team.teamId];
    const score = scores[team.teamId] ?? 0;

    // Where this team should currently be
    const assignedStationId = team.currentStationId || stationId;
    const assignedColor = stationIdToColor(assignedStationId);

    // Last station they scanned (from QR)
    const scannedStationId = team.lastScannedStationId || null;
    const hasScanForThisAssignment =
      scannedStationId && scannedStationId === assignedStationId;

    // ---- use taskIndex + submission to derive detailed status ----
    const currentTaskIndex = roomState.taskIndex;
    const isCurrentTask =
      latest &&
      typeof latest.taskIndex === "number" &&
      latest.taskIndex === currentTaskIndex &&
      latest.answerText !== "";

    const timedOut =
      latest &&
      typeof latest.taskIndex === "number" &&
      latest.taskIndex === currentTaskIndex &&
      latest.answerText === "" &&
      latest.timeMs != null;

    let statusLine = "";
    if (!hasScanForThisAssignment) {
      statusLine = "Waiting for a scan…";
    } else if (hasScanForThisAssignment && currentTaskIndex < 0) {
      statusLine = "Scanned and ready";
    } else if (hasScanForThisAssignment && timedOut) {
      statusLine = "Timed out";
    } else if (hasScanForThisAssignment && isCurrentTask) {
      statusLine = "Answer submitted";
    } else if (hasScanForThisAssignment && currentTaskIndex >= 0) {
      statusLine = "Awaiting task response";
    } else {
      statusLine = "Waiting…";
    }

    const subtleTextColor = "#6b7280";

    return (
      <div
        key={station.id}
        style={{
          borderRadius: 12,
          padding: 12,
          minWidth: 220,
          minHeight: 130,
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: "0 1px 3px rgba(15,23,42,0.16)",
          border: hasScanForThisAssignment
            ? "2px solid rgba(15,23,42,0.25)"
            : "1px solid #e5e7eb",
          transition: "background 0.2s ease, border 0.2s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
                color: subtleTextColor,
              }}
            >
              {station.id}
            </div>
            <div style={{ fontWeight: 700 }}>
              {team.teamName || "Team"}
            </div>
            {Array.isArray(team.members) && team.members.length > 0 && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: "0.8rem",
                  color: subtleTextColor,
                }}
              >
                ({team.members.join(", ")})
              </div>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
                color: subtleTextColor,
              }}
            >
              Score
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
              }}
            >
              {score}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: "0.8rem",
            color: "#374151",
          }}
        >
          {statusLine}
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: "0.75rem",
          }}
        >
          <div>
            <strong>Assigned to:</strong>{" "}
            {assignedColor
              ? `${assignedColor.toUpperCase()} (${assignedStationId})`
              : assignedStationId || "—"}
          </div>
          <div
            style={{
              marginTop: 2,
              color: subtleTextColor,
            }}
          >
            Last scanned: {scannedStationId || "—"}
          </div>
        </div>

        {/* Colour band at the bottom */}
        <div
          style={{
            marginTop: 8,
            height: 6,
            borderRadius: 999,
            backgroundColor: assignedColor
              ? assignedColor
              : "rgba(148,163,184,0.5)",
          }}
        />
      </div>
    );
  };

  // NEW: render a card anchored by TEAM (stable position),
  // using currentStationId just for colour/station info.
  const renderTeamCard = (teamId) => {
    const team = teamsById[teamId];
    if (!team) return null;

    const assignedStationId = team.currentStationId || null;
    const assignedColor = stationIdToColor(assignedStationId);

    const latest = submissions[teamId];
    const score = scores[teamId] ?? 0;

    const scannedStationId = team.lastScannedStationId || null;
    const hasScanForThisAssignment =
      scannedStationId && scannedStationId === assignedStationId;

    const currentTaskIndex = roomState.taskIndex;

    const isCurrentTask =
      latest &&
      typeof latest.taskIndex === "number" &&
      latest.taskIndex === currentTaskIndex &&
      latest.answerText !== "";

    const timedOut =
      latest &&
      typeof latest.taskIndex === "number" &&
      latest.taskIndex === currentTaskIndex &&
      latest.answerText === "" &&
      latest.timeMs != null;

    const hasTreatPending = pendingTreatTeams.includes(teamId);

    let statusLine = "";
    if (!hasScanForThisAssignment) {
      statusLine = "Waiting for a scan…";
    } else if (hasScanForThisAssignment && currentTaskIndex < 0) {
      statusLine = "Scanned and ready";
    } else if (hasScanForThisAssignment && timedOut) {
      statusLine = "Timed out";
    } else if (hasScanForThisAssignment && isCurrentTask) {
      statusLine = "Answer submitted";
    } else if (hasScanForThisAssignment && currentTaskIndex >= 0) {
      statusLine = "Awaiting task response";
    } else {
      statusLine = "Waiting…";
    }

    const bubbleBg = hasScanForThisAssignment
      ? isCurrentTask
        ? "#ecfdf5"
        : "#eff6ff"
      : "#ffffff";

    const textColor = "#111827";

    const members = Array.isArray(team.members) ? team.members : [];

    return (
      <div
        key={teamId}
        style={{
          borderRadius: 12,
          padding: 12,
          minWidth: 220,
          minHeight: 130,
          background: bubbleBg,
          color: textColor,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: "0 1px 3px rgba(15,23,42,0.16)",
          border: hasScanForThisAssignment
            ? "2px solid rgba(15,23,42,0.25)"
            : "1px solid #e5e7eb",
          transition: "background 0.2s ease, border 0.2s ease",
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
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "#6b7280",
              }}
            >
              Team
            </div>
            <div
              style={{
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              {team.teamName || "Team"}
            </div>
            {members.length > 0 && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#4b5563",
                  marginTop: 2,
                }}
              >
                ({members.join(", ")})
              </div>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                color: "#6b7280",
              }}
            >
              Score
            </div>
            <div
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
              }}
            >
              {score}
            </div>
            {assignedColor && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: "0.75rem",
                  color: "#6b7280",
                }}
              >
                {assignedColor.toUpperCase()}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: "0.8rem",
            color: "#374151",
          }}
        >
          {statusLine}
        </div>
        {assignedStationId && (
          <div
            style={{
              marginTop: 4,
              fontSize: "0.75rem",
              color: "#6b7280",
            }}
          >
            Station: {assignedStationId}
          </div>
        )}
        {hasTreatPending && (
          <div
            style={{
              marginTop: 6,
              fontSize: "0.8rem",
              color: "#b45309",
              fontWeight: 600,
            }}
          >
            🍬 See teacher for a treat!
          </div>
        )}
      </div>
    );
  };

  const noiseLabel = !noiseEnabled
    ? "Off"
    : noiseThreshold < 40
    ? "Light"
    : noiseThreshold < 70
    ? "Moderate"
    : "Strict";

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
          <h1 style={{ margin: 0 }}>Live session</h1>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "#4b5563",
            }}
          >
            {roomCode
              ? `Room: ${roomCode.toUpperCase()}`
              : "No room selected."}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "#6b7280",
            }}
          >
            Status: {status}
          </p>
        </div>

        {/* Quick task / taskset controls */}
        <div
          style={{
            marginBottom: 0,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            minWidth: 280,
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              marginBottom: 8,
              color: "#374151",
            }}
          >
            <strong>Active taskset:</strong>{" "}
            {activeTasksetMeta ? (
              <>
                {activeTasksetMeta.name}{" "}
                {activeTasksetMeta.numTasks != null && (
                  <span style={{ color: "#6b7280" }}>
                    ({activeTasksetMeta.numTasks} tasks)
                  </span>
                )}
                {loadedTasksetId === activeTasksetMeta._id ? (
                  <span style={{ color: "#059669" }}>
                    {" "}
                    – loaded in room
                  </span>
                ) : (
                  <span> – not yet loaded in this room</span>
                )}
              </>
            ) : (
              <>No active taskset. Set one on the Task Sets page.</>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Quick task prompt…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                flex: 2,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                fontSize: "0.8rem",
              }}
            />
            <input
              type="text"
              placeholder="Correct answer (optional)"
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              style={{
                flex: 1.3,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                fontSize: "0.8rem",
              }}
            />
          </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleLaunchQuickTask}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: "#0ea5e9",
                  color: "#ffffff",
                  fontSize: "0.85rem",
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
              <button
                type="button"
                onClick={handleLaunchTaskset}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: "#10b981",
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  cursor: taskFlowActive ? "not-allowed" : "pointer",
                  opacity:
                    !activeTasksetMeta || taskFlowActive ? 0.5 : 1,
                }}
                disabled={!activeTasksetMeta || taskFlowActive}
              >
                Launch from taskset
              </button>
            </div>

            {/* New row: skip + end session, only active once a taskset is running */}
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
              <button
                type="button"
                onClick={handleEndSessionAndEmail}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: "#ef4444",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  cursor:
                    taskFlowActive && !isEndingSession
                      ? "pointer"
                      : "not-allowed",
                  opacity:
                    taskFlowActive && !isEndingSession ? 1 : 0.4,
                }}
                disabled={!taskFlowActive || isEndingSession}
              >
                {isEndingSession
                  ? "Ending session…"
                  : "End session & email reports"}
              </button>
            </div>
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
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 12,
                // Optionally show noise-based dimming on teacher view as a cue
                opacity: noiseEnabled ? noiseBrightness : 1,
                transition: "opacity 0.15s ease-out",
              }}
            >
              {teamIdsForGrid.map((teamId) => renderTeamCard(teamId))}
            </div>
          )}
        </div>

        {/* Right column: classroom controls + leaderboard + scan log */}
        <div
          style={{
            flex: 1.2,
            minWidth: 260,
            borderLeft: "1px solid #e5e7eb",
            paddingLeft: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Classroom controls: noise + treats */}
          <div
            style={{
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              padding: 8,
              background: "#ffffff",
              fontSize: "0.8rem",
            }}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Classroom controls
            </div>

            {/* Noise control */}
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 2,
                }}
              >
                <span>Noise control</span>
                <span style={{ color: "#6b7280" }}>
                  {noiseLabel}
                  {noiseEnabled && (
                    <>
                      {" "}
                      • noise: {Math.round(noiseLevel)}
                    </>
                  )}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={noiseThreshold}
                onChange={handleNoiseSliderChange}
                style={{ width: "100%" }}
              />
              <div
                style={{
                  marginTop: 2,
                  fontSize: "0.7rem",
                  color: "#6b7280",
                }}
              >
                0 = off • higher = stricter noise expectations
              </div>
            </div>

            {/* Treats control */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 2,
                }}
              >
                <span>Random treats</span>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: "0.75rem",
                    color: "#374151",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={treatsConfig.enabled}
                    onChange={handleToggleTreatsEnabled}
                  />
                  Enabled
                </label>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    color: "#4b5563",
                  }}
                >
                  Treats this session:{" "}
                </label>
                <input
                  type="number"
                  min={0}
                  value={treatsConfig.total}
                  onChange={handleTreatsTotalChange}
                  style={{
                    width: 60,
                    padding: "2px 4px",
                    fontSize: "0.75rem",
                    borderRadius: 4,
                    border: "1px solid #d1d5db",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "#6b7280",
                  }}
                >
                  Given: {treatsConfig.given}/{treatsConfig.total}
                </span>
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: "0.7rem",
                  color: "#6b7280",
                }}
              >
                Students see a “See your teacher for a treat” prompt when
                selected.
              </div>
            </div>
          </div>

          {/* Leaderboard */}
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Leaderboard</h2>
            {leaderboard.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No scores yet.</p>
            ) : (
              <ol
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  fontSize: "0.85rem",
                }}
              >
                {leaderboard.map(([teamId, score], idx) => {
                  const team = teamsById[teamId] || {};
                  const name = team.teamName || `Team ${idx + 1}`;
                  const members = Array.isArray(team.members)
                    ? team.members
                    : [];
                  return (
                    <li
                      key={teamId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "4px 0",
                        borderBottom: "1px dashed #e5e7eb",
                      }}
                    >
                      <div>
                        <strong>{name}</strong>
                        {members.length > 0 && (
                          <span style={{ color: "#6b7280", marginLeft: 4 }}>
                            ({members.join(", ")})
                          </span>
                        )}
                      </div>
                      <div>{score} pts</div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Scan log */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              padding: 8,
              background: "#f9fafb",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontSize: "0.8rem",
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              Scan log
            </div>
            {scanEvents.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                No scans yet.
              </p>
            ) : (
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  fontSize: "0.8rem",
                }}
              >
                {scanEvents.map((ev, idx) => {
                  const color = stationIdToColor(ev.stationId);
                  const when = ev.timestamp
                    ? new Date(ev.timestamp).toLocaleTimeString()
                    : "";
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "2px 0",
                        borderBottom: "1px dashed #e5e7eb",
                      }}
                    >
                      <div>
                        <strong>{ev.teamName || "Team"}</strong> scanned{" "}
                        {color
                          ? color.toUpperCase()
                          : ev.stationId || "unknown station"}{" "}
                        <span style={{ color: "#9ca3af" }}>{when}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* End session & email reports */}
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              paddingTop: 8,
              fontSize: "0.8rem",
            }}
          >
            <button
              type="button"
              onClick={handleEndSessionAndEmail}
              disabled={isEndingSession}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "none",
                background: "#ef4444",
                color: "#ffffff",
                fontSize: "0.8rem",
                cursor: "pointer",
                opacity: isEndingSession ? 0.7 : 1,
              }}
            >
              {isEndingSession
                ? "Ending session & emailing reports…"
                : "End session & email reports"}
            </button>
            {endSessionMessage && (
              <p
                style={{
                  marginTop: 4,
                  color: "#374151",
                }}
              >
                {endSessionMessage}
              </p>
            )}
          </div>
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
            {/* Simple rectangle with station labels around perimeter */}
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
                  (2 * Math.PI * idx) / Math.max(1, roomSetup.stations.length);
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
