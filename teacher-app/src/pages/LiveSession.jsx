// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useState } from "react";
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
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
  return COLORS[idx] || null;
}

export default function LiveSession({ roomCode }) {
  const [status, setStatus] = useState("Checking connection…");
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
  });
  const [submissions, setSubmissions] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);

  // Quick task fields
  const [prompt, setPrompt] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");

  // Which taskset is loaded in this room (from server)
  const [loadedTasksetId, setLoadedTasksetId] = useState(null);

  // Which taskset the teacher chose in TaskSets (from localStorage)
  const [activeTasksetMeta, setActiveTasksetMeta] = useState(() => {
    try {
      const raw = localStorage.getItem("curriculateActiveTasksetMeta");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // If TaskSets asked us to "launch now"
  const [autoLaunchRequested, setAutoLaunchRequested] = useState(false);

  // Join as teacher whenever roomCode changes
  useEffect(() => {
    if (!roomCode) {
      setStatus("No room selected.");
      return;
    }

    setStatus("Joining room…");

    socket.emit("joinRoom", {
      roomCode: roomCode.toUpperCase(),
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
  }, [
    autoLaunchRequested,
    roomCode,
    activeTasksetMeta?._id,
    loadedTasksetId,
  ]);

  // Socket listeners
  useEffect(() => {
    const handleRoom = (state) => {
      setRoomState(state || { stations: [], teams: {}, scores: {} });
    };

    const handleLeaderboard = (scores) => {
      const entries = Object.entries(scores || {}).sort(
        (a, b) => b[1] - a[1]
      );
      setLeaderboard(entries);
    };

    const handleTasksetLoaded = (info) => {
      console.log("Taskset loaded:", info);
      if (info && info.tasksetId) {
        setLoadedTasksetId(info.tasksetId);

        // Keep local meta fresh from the server
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
      // ev: { roomCode, teamId, teamName, stationId, assignedStationId, timestamp }
      setScanEvents((prev) => {
        const next = [ev, ...prev];
        return next.slice(0, 30); // keep last 30
      });
    };

    // OLD behaviour (2 days ago)
    socket.on("roomState", handleRoom);
    socket.on("leaderboardUpdate", handleLeaderboard);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("taskSubmission", handleSubmission);
    socket.on("scanEvent", handleScanEvent);

    // NEW: also accept room:state if server started using that
    socket.on("room:state", handleRoom);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("leaderboardUpdate", handleLeaderboard);
      socket.off("tasksetLoaded", handleTasksetLoaded);
      socket.off("taskSubmission", handleSubmission);
      socket.off("scanEvent", handleScanEvent);
      socket.off("room:state", handleRoom);
    };
  }, []);

  const handleLaunchQuickTask = () => {
    if (!roomCode || !prompt.trim()) return;
    socket.emit("teacherLaunchTask", {
      roomCode: roomCode.toUpperCase(),
      prompt: prompt.trim(),
      correctAnswer: correctAnswer.trim(),
    });
    setPrompt("");
    setCorrectAnswer("");
  };

  const handleLaunchTaskset = () => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();

    if (!activeTasksetMeta?._id) {
      alert(
        'No active task set selected.\n\nGo to the Task Sets page and click "Use in Live Session" on the set you want.'
      );
      return;
    }

    // If the room doesn't yet have this taskset loaded, load it first.
    if (loadedTasksetId !== activeTasksetMeta._id) {
      socket.emit("loadTaskset", {
        roomCode: code,
        tasksetId: activeTasksetMeta._id,
      });
      alert(
        `Loading "${activeTasksetMeta.name}" into room ${code}.\n\nWhen you see "Taskset loaded" (and students are ready), click "Launch from taskset" again to send the first task.`
      );
      return;
    }

    // If it IS already loaded, just launch the next task
    socket.emit("launchTaskset", { roomCode: code });
  };

  // Derived helpers
  const stations = roomState.stations || [];
  const teamsById = roomState.teams || {};
  const scores = roomState.scores || {};

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
    const score = scores[team.teamName] ?? 0;

    // Where this team should currently be
    const assignedStationId = team.currentStationId || stationId;
    const assignedColor = stationIdToColor(assignedStationId);

    // Last station they scanned (from QR) – backend ensures this only
    // matches correct assignments
    const scannedStationId = team.lastScannedStationId || null;
    const hasScanForThisAssignment =
      scannedStationId && scannedStationId === assignedStationId;

    // Bubble colour: grey until correct scan, then assigned colour
    const bubbleBg =
      hasScanForThisAssignment && assignedColor ? assignedColor : "#f9fafb";
    const textColor =
      hasScanForThisAssignment && assignedColor ? "#ffffff" : "#111827";
    const subtleTextColor =
      hasScanForThisAssignment && assignedColor
        ? "rgba(241,245,249,0.9)"
        : "#6b7280";

    const isCorrect = latest?.correct ?? null;

    return (
      <div
        key={station.id}
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
        {/* Station + Team */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.7rem",
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
                  fontSize: "0.7rem",
                  color: subtleTextColor,
                  marginTop: 2,
                }}
              >
                {team.members.join(", ")}
              </div>
            )}

            {/* Assigned vs scan status */}
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
                  color: hasScanForThisAssignment ? "#bbf7d0" : subtleTextColor,
                  fontStyle: hasScanForThisAssignment ? "normal" : "italic",
                }}
              >
                {hasScanForThisAssignment
                  ? "Scanned and ready"
                  : "Waiting for a scan…"}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: 1,
                color: subtleTextColor,
              }}
            >
              Score
            </div>
            <div
              style={{
                fontSize: "1.4rem",
                fontWeight: 800,
              }}
            >
              {score}
            </div>
          </div>
        </div>

        {/* Latest submission summary */}
        {latest ? (
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: hasScanForThisAssignment
                ? "1px solid rgba(241,245,249,0.6)"
                : "1px solid rgba(148,163,184,0.4)",
              fontSize: "0.8rem",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div
              style={{
                maxWidth: "65%",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={latest.answerText}
            >
              <strong>Ans:</strong> {latest.answerText || "—"}
            </div>

            <div style={{ textAlign: "right" }}>
              {isCorrect !== null && (
                <div>{isCorrect ? "✅ correct" : "❌ incorrect"}</div>
              )}
              {latest.timeMs != null && (
                <div>
                  <strong>Time:</strong>{" "}
                  {(latest.timeMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: hasScanForThisAssignment
                ? "1px dashed rgba(241,245,249,0.6)"
                : "1px dashed rgba(148,163,184,0.4)",
              fontSize: "0.75rem",
              color: subtleTextColor,
            }}
          >
            No submission yet
          </div>
        )}
      </div>
    );
  };

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
          <h2 style={{ fontSize: "1rem", marginBottom: 4 }}>
            Quick task / taskset controls
          </h2>

          {/* Active taskset info */}
          <div
            style={{
              fontSize: "0.8rem",
              color: "#6b7280",
              marginBottom: 8,
            }}
          >
            {activeTasksetMeta?._id ? (
              <>
                Active taskset:{" "}
                <strong>{activeTasksetMeta.name}</strong>{" "}
                ({activeTasksetMeta.numTasks ?? "?"} tasks)
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
              placeholder="Quick task prompt"
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
                cursor: "pointer",
              }}
            >
              Launch quick task
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
                cursor: "pointer",
              }}
            >
              Launch from taskset
            </button>
          </div>
        </div>
      </div>

      {/* Main body: stations + leaderboard + debug log */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Stations grid */}
        <div style={{ flex: 3, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Stations</h2>
          {stations.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No stations yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 12,
              }}
            >
              {stations.map((s) => renderStationCard(s))}
            </div>
          )}
        </div>

        {/* Right column: leaderboard + scan log */}
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
          {/* Leaderboard */}
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Leaderboard</h2>
            {leaderboard.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No scores yet.</p>
            ) : (
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                {leaderboard.map(([name, pts]) => (
                  <li key={name} style={{ marginBottom: 4 }}>
                    <strong>{name}</strong> — {pts} pts
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Scan log (debug) */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 8,
              borderTop: "1px solid #e5e7eb",
              fontSize: "0.8rem",
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
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                }}
              >
                Scan log (debug)
              </h3>
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "#6b7280",
                }}
              >
                latest {scanEvents.length}{" "}
                {scanEvents.length === 1 ? "event" : "events"}
              </span>
            </div>

            {scanEvents.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  color: "#9ca3af",
                }}
              >
                No scans yet.
              </p>
            ) : (
              <div
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: 6,
                }}
              >
                {scanEvents.map((ev, idx) => {
                  const t = new Date(ev.timestamp);
                  const timeStr = t.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
                  const color = stationIdToColor(ev.stationId);

                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "2px 4px",
                        borderBottom:
                          idx === scanEvents.length - 1
                            ? "none"
                            : "1px dashed #e5e7eb",
                      }}
                    >
                      <div>
                        <strong>{timeStr}</strong> —{" "}
                        {ev.teamName || "Team"} scanned{" "}
                        {color ? color.toUpperCase() : ev.stationId}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
