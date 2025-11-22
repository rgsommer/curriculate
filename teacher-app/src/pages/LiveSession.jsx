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
  "lime",
  "navy",
  "brown",
  "gray",
];

function stationIdToColor(id) {
  const m = /^station-(\d+)$/.exec(id || "");
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
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
    useState(true);
  const [schoolName, setSchoolName] = useState("");
  const [perspectives, setPerspectives] = useState([]);

  // Load teacher profile once
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const res = await axios.get(`${API_BASE}/api/profile`);
        if (cancelled) return;
        const data = res.data || {};

        if (data.email) {
          setTeacherEmail(data.email);
          try {
            localStorage.setItem("curriculateTeacherEmail", data.email);
          } catch {
            // ignore
          }
        }

        if (Array.isArray(data.assessmentCategories)) {
          setAssessmentCategories(data.assessmentCategories);
        }

        if (typeof data.includeIndividualReports === "boolean") {
          setIncludeIndividualReports(data.includeIndividualReports);
        }

        if (data.schoolName) {
          setSchoolName(data.schoolName);
        }

        if (Array.isArray(data.perspectives)) {
          setPerspectives(data.perspectives);
        }
      } catch (err) {
        console.error("Failed to load teacher profile in LiveSession:", err);
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

  // Join room as teacher
  useEffect(() => {
    if (!roomCode) {
      setStatus("No room selected.");
      return;
    }

    setStatus("Joining room…");

    socket.emit("joinRoom", {
      roomCode,
      name: "Teacher",
      role: "teacher",
    });

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
      setLoadedTasksetId(info._id || info.id || null);

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

      if (info.tasksetId || info._id) {
        setStatus(`Taskset "${info.name}" loaded for room ${roomCode}.`);
      }
    };

    const handleTaskSubmission = (payload) => {
      if (!payload || !payload.teamId) return;

      setSubmissions((prev) => {
        const next = { ...prev };
        next[payload.teamId] = {
          ...payload,
          receivedAt: Date.now(),
        };
        return next;
      });
    };

    const handleScanEvent = (payload) => {
      if (!payload) return;
      setScanEvents((prev) => {
        const next = [{ ...payload, timestamp: Date.now() }, ...prev];
        return next.slice(0, 30);
      });
    };

    const handleTranscriptSent = ({ to }) => {
      setStatus("Transcript emailed.");
      if (to) {
        alert(`Transcript emailed to ${to}.`);
      } else {
        alert("Transcript emailed.");
      }
    };

    const handleTranscriptError = ({ message }) => {
      setStatus("Transcript error.");
      alert(message || "Failed to generate & send transcript.");
    };

    socket.on("roomState", handleRoom);
    socket.on("leaderboardUpdate", handleLeaderboard);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("taskSubmission", handleTaskSubmission);
    socket.on("scanEvent", handleScanEvent);
    socket.on("transcript:sent", handleTranscriptSent);
    socket.on("transcript:error", handleTranscriptError);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("leaderboardUpdate", handleLeaderboard);
      socket.off("tasksetLoaded", handleTasksetLoaded);
      socket.off("taskSubmission", handleTaskSubmission);
      socket.off("scanEvent", handleScanEvent);
      socket.off("transcript:sent", handleTranscriptSent);
      socket.off("transcript:error", handleTranscriptError);
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
  const roomLocation = roomState.taskset?.roomLocation || "Classroom";

  // Button: open Station Posters view
  const handleOpenStationPosters = () => {
    if (!roomCode) {
      alert("No room selected for this live session.");
      return;
    }
    navigate(
      `/station-posters?room=${encodeURIComponent(
        roomCode
      )}&location=${encodeURIComponent(roomLocation)}`
    );
  };

  // Group displays by station color (plus "unassigned")
  const groupedDisplays = useMemo(() => {
    const groups = {
      red: [],
      blue: [],
      green: [],
      yellow: [],
      purple: [],
      orange: [],
      teal: [],
      pink: [],
      lime: [],
      navy: [],
      brown: [],
      gray: [],
      unassigned: [],
    };

    for (const d of tasksetDisplays) {
      const key = (d.stationColor || "unassigned").toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    }
    return groups;
  }, [tasksetDisplays]);

  const orderedDisplayGroups = useMemo(() => {
    const order = [
      "red",
      "blue",
      "green",
      "yellow",
      "purple",
      "orange",
      "teal",
      "pink",
      "lime",
      "navy",
      "brown",
      "gray",
      "unassigned",
    ];
    return order
      .map((key) => ({ key, items: groupedDisplays[key] || [] }))
      .filter((g) => g.items.length > 0);
  }, [groupedDisplays]);

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
            background: "#f9fafb",
            minHeight: 80,
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              color: "#6b7280",
              marginBottom: 4,
            }}
          >
            {stationId.toUpperCase()}
          </div>
          <div
            style={{
              fontSize: "0.9rem",
              color: "#9ca3af",
              fontStyle: "italic",
            }}
          >
            No team at this station yet.
          </div>
        </div>
      );
    }

    const latest = submissions[team.teamId] || null;
    const colorName = station.color || stationIdToColor(stationId);
    const score = scores[team.teamName] ?? 0;

    const bg =
      colorName === "red"
        ? "#fee2e2"
        : colorName === "blue"
        ? "#dbeafe"
        : colorName === "green"
        ? "#dcfce7"
        : colorName === "yellow"
        ? "#fef9c3"
        : colorName === "purple"
        ? "#f3e8ff"
        : colorName === "orange"
        ? "#ffedd5"
        : colorName === "teal"
        ? "#ccfbf1"
        : colorName === "pink"
        ? "#ffe4e6"
        : colorName === "lime"
        ? "#ecfccb"
        : colorName === "navy"
        ? "#e0e7ff"
        : colorName === "brown"
        ? "#f5e7da"
        : colorName === "gray"
        ? "#e5e7eb"
        : "#f3f4f6";

    return (
      <div
        key={station.id}
        style={{
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: bg,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minHeight: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#4b5563",
                marginBottom: 2,
              }}
            >
              {stationId.toUpperCase()}
            </div>
            <div
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
              }}
            >
              {team.teamName}
            </div>
            {team.members?.length > 0 && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#4b5563",
                  marginTop: 2,
                }}
              >
                {team.members.join(", ")}
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "#111827",
            }}
          >
            {score} pts
          </div>
        </div>

        {latest ? (
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: "1px dashed #e5e7eb",
              fontSize: "0.8rem",
            }}
          >
            <div style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: 600 }}>Ans:</span>{" "}
              <span title={latest.answer}>
                {String(latest.answer).length > 60
                  ? `${String(latest.answer).slice(0, 57)}…`
                  : latest.answer}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.75rem",
              }}
            >
              <span>
                {latest.correct === true && (
                  <span style={{ color: "#15803d", fontWeight: 600 }}>
                    ✅ correct
                  </span>
                )}
                {latest.correct === false && (
                  <span style={{ color: "#b91c1c", fontWeight: 600 }}>
                    ❌ incorrect
                  </span>
                )}
                {latest.correct == null && (
                  <span style={{ color: "#6b7280" }}>—</span>
                )}
              </span>
              {typeof latest.timeMs === "number" && (
                <span style={{ color: "#4b5563" }}>
                  {(latest.timeMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: "1px dashed #e5e7eb",
              fontSize: "0.8rem",
              color: "#6b7280",
            }}
          >
            No submission yet.
          </div>
        )}
      </div>
    );
  };

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
        {/* Left: Displays */}
        <div style={{ flex: 3, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Room setup</h2>
          <p
            style={{
              marginTop: 0,
              marginBottom: 12,
              fontSize: "0.85rem",
              color: "#4b5563",
            }}
          >
            These are the printed station displays for this task set. Place
            each colour’s sheet at its matching station.
          </p>

          {orderedDisplayGroups.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No station displays are defined for this task set.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 10,
              }}
            >
              {orderedDisplayGroups.map(({ key, items }) => {
                const colorKey = key;
                const chipColor =
                  colorKey === "unassigned" ? "#374151" : colorKey;
                const label =
                  colorKey === "unassigned"
                    ? "Unassigned / floating displays"
                    : `${colorKey.toUpperCase()} station`;

                return (
                  <div
                    key={colorKey}
                    style={{
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background:
                              colorKey === "unassigned"
                                ? "#6b7280"
                                : chipColor,
                          }}
                        />
                        <div
                          style={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
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
                        {items.length} display
                        {items.length === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr)",
                        gap: 6,
                      }}
                    >
                      {items.map((d) => (
                        <div
                          key={d.key || d.name}
                          style={{
                            borderRadius: 8,
                            border: "1px dashed #d1d5db",
                            padding: 8,
                            background: "#ffffff",
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
                                marginTop: 4,
                                fontSize: "0.75rem",
                                color: "#6b7280",
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
            {leaderboard.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                No scores yet.
              </p>
            ) : (
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: "0.85rem",
                }}
              >
                {leaderboard.map((entry, idx) => (
                  <li key={entry.teamName + idx}>
                    {entry.teamName} — {entry.score} pts
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
                  fontSize: "0.8rem",
                  color: "#6b7280",
                  margin: 0,
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
        {/* Left: Stations, leaderboard, scan log */}
        <div style={{ flex: 3, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Stations</h2>
          {stations.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              No stations yet. Once student devices join this room, they will
              appear here with their assigned colours and scores.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 10,
              }}
            >
              {stations.map((s) => renderStationCard(s))}
            </div>
          )}

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "1.2fr 1.2fr",
              gap: 12,
            }}
          >
            {/* Leaderboard */}
            <div
              style={{
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
              {leaderboard.length === 0 ? (
                <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                  No scores yet.
                </p>
              ) : (
                <ol
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: "0.85rem",
                  }}
                >
                  {leaderboard.map((entry, idx) => (
                    <li key={entry.teamName + idx}>
                      {idx + 1}. {entry.teamName} — {entry.score} pts
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Scan log */}
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
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
                    fontSize: "0.8rem",
                    color: "#6b7280",
                    margin: 0,
                  }}
                >
                  No scans yet.
                </p>
              ) : (
                <div
                  style={{
                    maxHeight: 180,
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

        {/* Right: Room status, quick controls, transcript & reports */}
        <div
          style={{
            flex: 2,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Room / status header */}
          <div
            style={{
              marginBottom: 0,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#ffffff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1rem",
                }}
              >
                Room view
              </h2>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#6b7280",
                }}
              >
                Task set:{" "}
                <span style={{ fontWeight: 600 }}>{currentTasksetName}</span>
              </div>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "#4b5563",
              }}
            >
              {roomCode ? `Room: ${roomCode}` : "No room selected."} · Location:{" "}
              {roomLocation}
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

          {/* Quick task / taskset controls CARD */}
          <div
            style={{
              marginBottom: 0,
              padding: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              minWidth: 0,
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
                    <> — loaded in room.</>
                  ) : (
                    <> — not loaded yet.</>
                  )}
                </>
              ) : (
                <>No active taskset selected.</>
              )}
            </div>

            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.8rem",
                  color: "#4b5563",
                  marginBottom: 2,
                }}
              >
                Quick task prompt:
              </label>
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask a quick question to the room…"
                style={{
                  width: "100%",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "0.85rem",
                  padding: 6,
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.8rem",
                  color: "#4b5563",
                  marginBottom: 2,
                }}
              >
                Correct answer (optional):
              </label>
              <input
                type="text"
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                placeholder="Used for auto-marking where applicable"
                style={{
                  width: "100%",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "0.85rem",
                  padding: "4px 6px",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
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

            <div
              style={{
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              Use your taskset’s full tasks for structured sessions, or fire a
              quick question to reset focus.
            </div>
          </div>

          {/* Transcript & Reports CARD */}
          <div
            style={{
              marginBottom: 0,
              padding: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#ffffff",
              minWidth: 0,
            }}
          >
            <h2 style={{ fontSize: "1rem", marginBottom: 4 }}>
              Transcript & Reports
            </h2>

            <p
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "0.8rem",
                color: "#6b7280",
              }}
            >
              When you’re finished, end the session and get a PDF transcript
              (and, if enabled, one-page reports for each student).
            </p>

            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                color: "#4b5563",
                marginBottom: 4,
              }}
            >
              Transcript email:
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input
                type="email"
                placeholder="you@school.org"
                value={teacherEmail}
                onChange={(e) => setTeacherEmail(e.target.value)}
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  borderRadius: 4,
                  border: "1px solid #d1d5db",
                  fontSize: "0.8rem",
                }}
              />
              <button
                type="button"
                onClick={handleEndAndEmailTranscript}
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: "#6366f1",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                End & email
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <input
                id="include-individual-reports"
                type="checkbox"
                checked={includeIndividualReports}
                onChange={(e) =>
                  setIncludeIndividualReports(e.target.checked)
                }
              />
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "#4b5563",
                }}
              >
                Include one-page student reports in PDF
              </span>
            </div>

            {assessmentCategories && assessmentCategories.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: "0.75rem",
                  color: "#6b7280",
                }}
              >
                Categories:{" "}
                {assessmentCategories
                  .map((c) => c.label || c.name || c)
                  .filter(Boolean)
                  .join(", ") || "—"}
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
        padding: 16,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.2rem",
            }}
          >
            Room view
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "#6b7280",
            }}
          >
            Monitor stations, scores, and send transcripts when you’re done.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              padding: 2,
              borderRadius: 999,
              background: "#e5e7eb",
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
              Room view
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

          <button
            type="button"
            onClick={handleOpenStationPosters}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
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

      {viewMode === "setup" ? renderSetupView() : renderLiveView()}
    </div>
  );
}
