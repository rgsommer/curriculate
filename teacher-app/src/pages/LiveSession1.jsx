// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { socket } from "../socket";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL;

export default function LiveSession({ roomCode: propRoomCode }) {
  const params = useParams();
  const navigate = useNavigate();

  const roomCode = (propRoomCode || params.roomCode || "").toUpperCase();

  const [roomState, setRoomState] = useState({
    teams: {},
    stations: {},
    scores: {},
    taskIndex: -1,
  });

  const [status, setStatus] = useState("Waiting for room…");

  // Taskset / launching state
  const [activeTasksetMeta, setActiveTasksetMeta] = useState(null);
  const [loadedTasksetId, setLoadedTasksetId] = useState(null);
  const [tasksetStatus, setTasksetStatus] = useState("No task set loaded.");

  // Transcript / profile settings
  const [teacherEmail, setTeacherEmail] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [assessmentCategories, setAssessmentCategories] = useState([]);
  const [includeIndividualReports, setIncludeIndividualReports] =
    useState(false);
  const [perspectives, setPerspectives] = useState([]);
  const [emailStatus, setEmailStatus] = useState("");

  // Derived helpers
  const teamsArray = useMemo(
    () => Object.values(roomState.teams || {}),
    [roomState.teams]
  );

  const scoresByTeamId = roomState.scores || {};
  const leaderboard = useMemo(
    () =>
      [...teamsArray]
        .map((t) => ({
          ...t,
          points: scoresByTeamId[t.teamId] || 0,
        }))
        .sort((a, b) => b.points - a.points),
    [teamsArray, scoresByTeamId]
  );

  // ---------------------------------------------
  // Load profile (for transcript defaults)
  // ---------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const res = await axios.get(`${API_BASE}/api/profile`);
        const data = res.data || {};
        if (cancelled) return;

        if (data.email) setTeacherEmail(data.email);
        if (data.schoolName) setSchoolName(data.schoolName);
        if (Array.isArray(data.assessmentCategories)) {
          setAssessmentCategories(data.assessmentCategories);
        }
        if (typeof data.includeIndividualReports === "boolean") {
          setIncludeIndividualReports(data.includeIndividualReports);
        } else if (typeof data.includeStudentReports === "boolean") {
          setIncludeIndividualReports(data.includeStudentReports);
        }
        if (Array.isArray(data.perspectives)) {
          setPerspectives(data.perspectives);
        }
      } catch (err) {
        console.error("Failed to load presenter profile:", err);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------
  // Restore active taskset from localStorage
  // (set on TaskSets page)
  // ---------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem("curriculateActiveTasksetMeta");
      if (raw) {
        const meta = JSON.parse(raw);
        if (meta && meta._id) {
          setActiveTasksetMeta(meta);
        }
      }
    } catch (e) {
      console.warn("Could not read active taskset meta from localStorage", e);
    }
  }, []);

  // ---------------------------------------------
  // Socket listeners (room:state, taskset, transcript)
  // ---------------------------------------------
  useEffect(() => {
    const handleRoomState = (state) => {
      if (!state) return;
      setRoomState(state);
      setStatus("Connected – teams and scores updating.");
    };

    const handleTasksetLoaded = (payload) => {
      setLoadedTasksetId((prev) => prev ?? activeTasksetMeta?._id || null);
      if (payload && payload.name) {
        setTasksetStatus(
          `Loaded "${payload.name}" (${payload.tasks ?? "?"} tasks)`
        );
      } else {
        setTasksetStatus("Task set loaded.");
      }
    };

    const handleTasksetError = (payload) => {
      const msg = payload?.message || "Task set error.";
      setTasksetStatus(msg);
    };

    const handleTranscriptSent = () => {
      setEmailStatus("Transcript email sent.");
    };

    const handleTranscriptError = (payload) => {
      const msg = payload?.message || "Failed to send transcript.";
      setEmailStatus(msg);
    };

    socket.on("room:state", handleRoomState);
    socket.on("taskset:loaded", handleTasksetLoaded);
    socket.on("taskset:error", handleTasksetError);
    socket.on("transcript:sent", handleTranscriptSent);
    socket.on("transcript:error", handleTranscriptError);

    return () => {
      socket.off("room:state", handleRoomState);
      socket.off("taskset:loaded", handleTasksetLoaded);
      socket.off("taskset:error", handleTasksetError);
      socket.off("transcript:sent", handleTranscriptSent);
      socket.off("transcript:error", handleTranscriptError);
    };
  }, [activeTasksetMeta?._id]);

  // ---------------------------------------------
  // Auto-launch when coming from TaskSets ("Launch now")
  // ---------------------------------------------
  useEffect(() => {
    if (!roomCode) return;

    const flag = localStorage.getItem("curriculateLaunchImmediately");
    if (flag !== "true") return;

    // Clear the flag so we only try once
    localStorage.removeItem("curriculateLaunchImmediately");

    if (!activeTasksetMeta || !activeTasksetMeta._id) return;

    // If needed, load the set first, then start session + first task
    handleLoadActiveTaskset().then((ok) => {
      if (!ok) return;
      handleStartSessionAndFirstTask();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, activeTasksetMeta]);

  // ---------------------------------------------
  // Actions
  // ---------------------------------------------
  const handleLoadActiveTaskset = async () => {
    if (!roomCode || !activeTasksetMeta?._id) {
      setTasksetStatus("No active task set selected.");
      return false;
    }

    setTasksetStatus("Loading task set…");
    return new Promise((resolve) => {
      socket.emit(
        "teacher:loadTaskset",
        { roomCode, tasksetId: activeTasksetMeta._id },
        // In this backend, there is no explicit ack, so we resolve optimistically.
      );
      // We'll rely on taskset:loaded / taskset:error events to update UI.
      setTimeout(() => resolve(true), 300);
    });
  };

  const handleStartSessionAndFirstTask = () => {
    if (!roomCode) return;
    socket.emit("teacher:startSession", { roomCode });
    socket.emit("teacher:nextTask", { roomCode });
    setStatus("Session running – first task launched.");
  };

  const handleNextTask = () => {
    if (!roomCode) return;
    socket.emit("teacher:nextTask", { roomCode });
    setStatus("Next task launched.");
  };

  const handleEndAndEmailTranscript = () => {
    if (!roomCode) return;

    const trimmedEmail = teacherEmail.trim();
    if (!trimmedEmail) {
      setEmailStatus("Please provide an email address first.");
      return;
    }

    setEmailStatus("Ending session and sending transcript…");

    socket.emit("teacher:endSessionAndEmail", {
      roomCode,
      teacherEmail: trimmedEmail,
      assessmentCategories,
      includeIndividualReports,
      schoolName,
      perspectives,
    });
  };

  // ---------------------------------------------
  // Render
  // ---------------------------------------------
  return (
    <div
      style={{
        height: "100%",
        padding: "16px 24px",
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "2fr 1.2fr",
        gap: 24,
      }}
    >
      {/* Left column: live room */}
      <div>
        <header
          style={{
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Live Session</h1>
            <p style={{ margin: "4px 0", fontSize: "0.9rem", color: "#4b5563" }}>
              {status}
            </p>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
              {tasksetStatus}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
              Room code
            </div>
            <div
              style={{
                fontSize: "1.6rem",
                letterSpacing: "0.18em",
                fontWeight: 700,
              }}
            >
              {roomCode || "— —"}
            </div>
          </div>
        </header>

        {/* Teams + stations */}
        <section>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Teams</h2>
          {teamsArray.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No teams have joined yet.</p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {teamsArray.map((team) => {
                const points = scoresByTeamId[team.teamId] || 0;
                return (
                  <div
                    key={team.teamId}
                    style={{
                      minWidth: 170,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                      }}
                    >
                      <strong
                        style={{
                          fontSize: "0.95rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {team.teamName}
                      </strong>
                      <span
                        style={{
                          fontSize: "0.85rem",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {points} pts
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                        fontSize: "0.8rem",
                        color: "#6b7280",
                      }}
                    >
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          background:
                            team.stationColor || "rgba(148,163,184,0.6)",
                          border: "1px solid rgba(148,163,184,0.9)",
                        }}
                      />
                      <span>
                        {team.stationColor
                          ? `${team.stationColor} station`
                          : "No station yet"}
                      </span>
                    </div>
                    {team.members && team.members.length > 0 && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#6b7280",
                          lineHeight: 1.3,
                        }}
                      >
                        {team.members.join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Session controls */}
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
            Session controls
          </h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleLoadActiveTaskset}
              disabled={!activeTasksetMeta}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: activeTasksetMeta ? "#eff6ff" : "#f9fafb",
                cursor: activeTasksetMeta ? "pointer" : "not-allowed",
                fontSize: "0.85rem",
              }}
            >
              {activeTasksetMeta
                ? `Load "${activeTasksetMeta.name}"`
                : "No active task set"}
            </button>

            <button
              type="button"
              onClick={handleStartSessionAndFirstTask}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "none",
                background: "#0ea5e9",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Start & launch first task
            </button>

            <button
              type="button"
              onClick={handleNextTask}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#f3f4f6",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Next task
            </button>

            <button
              type="button"
              onClick={() => navigate("/tasksets")}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Go to Task Sets
            </button>
          </div>
        </section>
      </div>

      {/* Right column: leaderboard + transcript */}
      <div>
        <section
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: 8 }}>
            Leaderboard
          </h2>
          {leaderboard.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No scores yet.</p>
          ) : (
            <ol
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {leaderboard.map((team, index) => (
                <li
                  key={team.teamId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 8px",
                    borderRadius: 999,
                    background:
                      index === 0 ? "#dcfce7" : "rgba(209,213,219,0.5)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: "#4b5563",
                      }}
                    >
                      {index + 1}.
                    </span>
                    <span
                      style={{
                        fontWeight: index === 0 ? 600 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {team.teamName}
                    </span>
                  </div>
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "0.9rem",
                    }}
                  >
                    {team.points} pts
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: 8 }}>
            Transcript & reports
          </h2>

          <div style={{ marginBottom: 8 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              Send transcript to
            </label>
            <input
              type="email"
              value={teacherEmail}
              onChange={(e) => setTeacherEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: "0.85rem",
              }}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                marginBottom: 2,
                color: "#4b5563",
              }}
            >
              School / organization
            </label>
            <input
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: "0.85rem",
              }}
            />
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.85rem",
              color: "#4b5563",
              marginBottom: 8,
            }}
          >
            <input
              type="checkbox"
              checked={includeIndividualReports}
              onChange={(e) => setIncludeIndividualReports(e.target.checked)}
            />
            Include individual student reports
          </label>

          <button
            type="button"
            onClick={handleEndAndEmailTranscript}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "none",
              background: "#22c55e",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            End session & email transcript
          </button>

          {emailStatus && (
            <p
              style={{
                marginTop: 8,
                fontSize: "0.8rem",
                color: "#4b5563",
              }}
            >
              {emailStatus}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
