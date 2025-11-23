// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { socket } from "../socket";

import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

// Expanded palette to allow up to 12 stations
const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
  "indigo",
  "lime",
  "amber",
  "cyan",
];

function stationIdToColor(id) {
  if (!id) return null;
  const match = /^station-(\d+)$/.exec(id);
  if (!match) return null;
  const idx = parseInt(match[1], 10) - 1;
  return COLORS[idx] || null;
}

export default function LiveSession({ roomCode: roomCodeProp }) {
  const params = useParams();
  const navigate = useNavigate();

  const roomCode = (roomCodeProp || params.roomCode || "").toUpperCase();

  const [status, setStatus] = useState("Checking connection…");
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
    taskset: null,
  });
  const [submissions, setSubmissions] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);

  const [prompt, setPrompt] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");

  const [loadedTasksetId, setLoadedTasksetId] = useState(null);
  const [activeTasksetMeta, setActiveTasksetMeta] = useState(() => {
    try {
      const raw = localStorage.getItem("curriculateActiveTasksetMeta");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [autoLaunchRequested, setAutoLaunchRequested] = useState(false);

  const [viewMode, setViewMode] = useState("live");

  // Teacher profile-driven info
  const [teacherEmail, setTeacherEmail] = useState(() => {
    try {
      return localStorage.getItem("curriculateTeacherEmail") || "";
    } catch {
      return "";
    }
  });
  const [assessmentCategories, setAssessmentCategories] = useState([]);
  const [includeIndividualReports, setIncludeIndividualReports] =
    useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [perspectives, setPerspectives] = useState([]);

  // Load teacher profile for transcript defaults
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const res = await axios.get(`${API_BASE}/api/profile`);
        const data = res.data || {};
        if (cancelled) return;

        if (data.email && !teacherEmail) {
          setTeacherEmail(data.email);
        }
        if (Array.isArray(data.assessmentCategories)) {
          setAssessmentCategories(data.assessmentCategories);
        }
        if (typeof data.includeIndividualReports === "boolean") {
          setIncludeIndividualReports(data.includeIndividualReports);
        } else if (typeof data.includeStudentReports === "boolean") {
          setIncludeIndividualReports(data.includeStudentReports);
        }
        if (data.schoolName) {
          setSchoolName(data.schoolName);
        }
        if (Array.isArray(data.perspectives)) {
          setPerspectives(data.perspectives);
        }
      } catch (err) {
        console.error("Failed to load presenter profile for LiveSession:", err);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep teacherEmail persisted
  useEffect(() => {
    if (!teacherEmail) return;
    try {
      localStorage.setItem("curriculateTeacherEmail", teacherEmail);
    } catch {
      // ignore
    }
  }, [teacherEmail]);

  // Join room as teacher (this was the broken bit)
  useEffect(() => {
    if (!roomCode) {
      setStatus("No room selected.");
      return;
    }

    setStatus("Creating room…");

    // Notify server to create room
    socket.emit("teacher:createRoom", { roomCode });

    setStatus("Connected.");
  }, [roomCode]);

  // Check for "launch immediately" flag from Task Sets page
  useEffect(() => {
    const flag = localStorage.getItem("curriculateLaunchImmediately");
    if (flag === "true") {
      localStorage.removeItem("curriculateLaunchImmediately");
      setAutoLaunchRequested(true);
    }
  }, []);

  // Auto-load & launch active taskset when requested
  useEffect(() => {
    if (!autoLaunchRequested) return;
    if (!roomCode || !activeTasksetMeta?._id) return;

    const desiredId = activeTasksetMeta._id;

    if (loadedTasksetId !== desiredId) {
      setStatus(`Loading taskset "${activeTasksetMeta.name}"…`);
      socket.emit("loadTaskset", {
        roomCode,
        tasksetId: desiredId,
      });
      return;
    }

    setStatus(`Launching "${activeTasksetMeta.name}"…`);
    socket.emit("launchTaskset", { roomCode });
    setAutoLaunchRequested(false);
  }, [
    autoLaunchRequested,
    roomCode,
    activeTasksetMeta?._id,
    activeTasksetMeta?.name,
    loadedTasksetId,
  ]);

  // Socket event wiring
  useEffect(() => {
    const handleRoom = (state) => {
      setRoomState(
        state || {
          stations: [],
          teams: {},
          scores: {},
          taskset: null,
        }
      );
    };

    const handleLeaderboard = (entries) => {
      setLeaderboard(entries || []);
    };

    const handleTasksetLoaded = (info) => {
      if (!info) return;
      setLoadedTasksetId(info.tasksetId || info._id || null);

      setActiveTasksetMeta((prev) => {
        const meta = {
          _id: info.tasksetId || info._id || prev?._id,
          name: info.name || prev?.name || "Loaded Taskset",
          numTasks: info.numTasks ?? prev?.numTasks ?? 0,
        };
        try {
          localStorage.setItem("curriculateActiveTasksetId", meta._id);
          localStorage.setItem(
            "curriculateActiveTasksetMeta",
            JSON.stringify(meta)
          );
        } catch {
          // ignore
        }
        return meta;
      });

      setStatus(
        `Taskset "${info.name || "Taskset"}" loaded into room ${roomCode}.`
      );
    };

    const handleSubmission = (sub) => {
      if (!sub?.teamId) return;
      setSubmissions((prev) => ({
        ...prev,
        [sub.teamId]: sub,
      }));
    };

    const handleScanEvent = (ev) => {
      setScanEvents((prev) => [ev, ...prev].slice(0, 60));
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("leaderboardUpdate", handleLeaderboard);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("taskSubmission", handleSubmission);
    socket.on("scanEvent", handleScanEvent);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("leaderboardUpdate", handleLeaderboard);
      socket.off("tasksetLoaded", handleTasksetLoaded);
      socket.off("taskSubmission", handleSubmission);
      socket.off("scanEvent", handleScanEvent);
    };
  }, [roomCode]);

  const handleLaunchQuickTask = () => {
    if (!roomCode || !prompt.trim()) return;
    socket.emit("teacherLaunchTask", {
      roomCode,
      prompt: prompt.trim(),
      correctAnswer: correctAnswer.trim(),
    });
    setPrompt("");
    setCorrectAnswer("");
    setStatus("Quick task launched.");
  };

  const handleLaunchTaskset = () => {
    if (!roomCode) {
      alert("No room selected for this live session.");
      return;
    }

    if (!activeTasksetMeta?._id) {
      alert(
        'No active task set selected.\n\nGo to the Task Sets page and click "Use in Live Session" on the set you want.'
      );
      return;
    }

    setAutoLaunchRequested(true);
    setStatus(
      `Preparing to launch "${activeTasksetMeta.name}" to room ${roomCode}…`
    );
  };

  const handleOpenRoomCodes = () => {
    navigate("/station-posters?location=classroom");
  };

  const handleEndAndEmailTranscript = () => {
    if (!roomCode) {
      alert("No room selected for this live session.");
      return;
    }
    if (!teacherEmail || !teacherEmail.includes("@")) {
      alert(
        "Please enter a valid teacher email address before sending the transcript."
      );
      return;
    }
    socket.emit("endSessionAndEmail", {
      roomCode,
      teacherEmail: teacherEmail.trim(),
      assessmentCategories,
      includeIndividualReports,
      schoolName,
      perspectives,
    });

    setStatus("Generating & emailing transcript…");
  };

  const stations = roomState.stations || [];
  const teamsById = roomState.teams || {};
  const scores = roomState.scores || {};
  const currentTasksetName =
    roomState.taskset?.name || activeTasksetMeta?.name || "—";
  const tasksetDisplays = roomState.taskset?.displays || [];

  const leaderboardWithNames = useMemo(() => {
    return leaderboard.map(([teamName, pts]) => ({
      teamName,
      pts,
    }));
  }, [leaderboard]);

  // ---- RENDER HELPERS BELOW ----
  // (All of this is your existing visual layout)

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

    const assignedStationId = team.currentStationId || stationId;
    const assignedColor = stationIdToColor(assignedStationId);
    const scannedStationId = team.lastScannedStationId || null;
    const hasScanForThisAssignment =
      scannedStationId && scannedStationId === assignedStationId;

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
              justifyContent: "space_between",
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

  // Group displays by station colour for the setup tab
  const groupedDisplays = useMemo(() => {
    const grouped = {};
    (tasksetDisplays || []).forEach((d) => {
      const key = (d.stationColor || "unassigned").toLowerCase();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(d);
    });
    return grouped;
  }, [tasksetDisplays]);

  const orderedDisplayGroups = useMemo(() => {
    const keys = Object.keys(groupedDisplays);
    if (!keys.length) return [];
    const colorOrder = [...COLORS, "unassigned"];
    return keys.sort((a, b) => {
      const ia = colorOrder.indexOf(a);
      const ib = colorOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [groupedDisplays]);

  const renderSetupView = () => {
    return (
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ flex: 3, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>
            Room setup checklist
          </h2>
          <p
            style={{
              marginTop: 0,
              marginBottom: 8,
              fontSize: "0.85rem",
              color: "#4b5563",
            }}
          >
            Taskset: <strong>{currentTasksetName}</strong>
          </p>

          {tasksetDisplays.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No displays defined for this task set. In the Task Sets editor,
              add “Physical displays / stations” and link tasks via the
              “Linked display” dropdown.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {orderedDisplayGroups.map((colorKey) => {
                const displays = groupedDisplays[colorKey] || [];
                const isUnassigned = colorKey === "unassigned";
                const label = isUnassigned
                  ? "Unassigned / floating displays"
                  : `${colorKey.toUpperCase()} station`;

                const chipColor = isUnassigned ? "#374151" : colorKey;

                return (
                  <div
                    key={colorKey}
                    style={{
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          background: chipColor,
                          border: "2px solid #e5e7eb",
                        }}
                      />
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.9rem",
                        }}
                      >
                        {label}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#6b7280",
                      }}
                    >
                      {isUnassigned
                        ? "These displays are not tied to a station colour yet."
                        : "Place these objects at this colour station before students arrive."}
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {displays.map((d) => (
                        <div
                          key={d.key}
                          style={{
                            borderRadius: 8,
                            border: "1px solid #e5e7eb",
                            background: "#ffffff",
                            padding: 8,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "0.9rem",
                            }}
                          >
                            {d.name || d.key}
                          </div>
                          {d.description && (
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#4b5563",
                                marginTop: 2,
                              }}
                            >
                              {d.description}
                            </div>
                          )}
                          {d.notesForTeacher && (
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#6b7280",
                                marginTop: 4,
                              }}
                            >
                              Notes: {d.notesForTeacher}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Leaderboard + Scan log */}
        <div style={{ flex: 2, minWidth: 0 }}>
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#ffffff",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: 6,
                fontSize: "0.9rem",
              }}
            >
              Leaderboard
            </h3>
            {leaderboardWithNames.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No scores yet.</p>
            ) : (
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                {leaderboardWithNames.map((row, idx) => (
                  <li key={row.teamName} style={{ marginBottom: 4 }}>
                    <strong>{row.teamName}</strong> — {row.pts} pts
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div
            style={{
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#ffffff",
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
    );
  };

  const renderLiveView = () => {
    return (
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
            {leaderboardWithNames.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No scores yet.</p>
            ) : (
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                {leaderboardWithNames.map((row, idx) => (
                  <li key={row.teamName} style={{ marginBottom: 4 }}>
                    <strong>{row.teamName}</strong> — {row.pts} pts
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
      <header
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
            {roomCode ? `Room: ${roomCode}` : "No room selected."}
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

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
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

          <button
            type="button"
            onClick={handleOpenRoomCodes}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Print station sheets
          </button>
        </div>
      </header>

      {/* View mode toggle */}
      <div
        style={{
          display: "flex",
          gap: 8,
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: 4,
        }}
      >
        <button
          type="button"
          onClick={() => setViewMode("live")}
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "none",
            fontSize: "0.85rem",
            cursor: "pointer",
            background:
              viewMode === "live" ? "#0ea5e9" : "transparent",
            color: viewMode === "live" ? "#ffffff" : "#374151",
          }}
        >
          Live view
        </button>
        <button
          type="button"
          onClick={() => setViewMode("setup")}
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "none",
            fontSize: "0.85rem",
            cursor: "pointer",
            background:
              viewMode === "setup" ? "#0ea5e9" : "transparent",
            color: viewMode === "setup" ? "#ffffff" : "#374151",
          }}
        >
          Room setup checklist
        </button>
      </div>

      {viewMode === "setup" ? renderSetupView() : renderLiveView()}
    </div>
  );
}
