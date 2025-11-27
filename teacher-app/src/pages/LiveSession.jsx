// teacher-app/src/pages/LiveSession.jsx

import React, { useEffect, useState, useRef } from "react";
import { socket } from "../socket";
import { useAuth } from "../auth/useAuth";
import { fetchMyProfile } from "../api/profile";
import api from "../api/client";

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
    startedAt: null,
    isActive: false,
  });

  // All submissions by teamId: { [teamId]: Submission[] }
  const [submissionsByTeam, setSubmissionsByTeam] = useState({});
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

  // NEW: profile + report-email state
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [sendingReports, setSendingReports] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [reportsAutoTriggered, setReportsAutoTriggered] = useState(false);

  // Which team's submissions drawer is open
  const [openSubmissionsTeamId, setOpenSubmissionsTeamId] = useState(null);

  // Room-setup visualization (and now also task timing)
  const [roomSetupTaskset, setRoomSetupTaskset] = useState(null);
  const [roomSetupLoading, setRoomSetupLoading] = useState(false);
  const [showRoomSetup, setShowRoomSetup] = useState(false);

  // Join sound when a team joins
  const joinSoundRef = useRef(null);

  // Local clock for progress bars
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const audio = new Audio("/sounds/join.mp3");
    audio.load();
    joinSoundRef.current = audio;
  }, []);

  // Load presenter profile (email + report preferences)
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const data = await fetchMyProfile();
        if (cancelled) return;
        setProfile(data || null);
      } catch (err) {
        console.error("Failed to load profile in LiveSession:", err);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  // Unlock audio on first teacher click (for autoplay-restricted browsers)
  useEffect(() => {
    const unlock = () => {
      const a = joinSoundRef.current;
      if (!a) return;
      a.muted = true;
      a
        .play()
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

  // Simple 1s tick for elapsed time
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Create the room + join it as teacher whenever roomCode changes
  useEffect(() => {
    if (!roomCode) {
      setStatus("No room selected.");
      return;
    }

    const code = roomCode.toUpperCase();
    setStatus(`Creating room ${code}…`);

    // Create/reset the room on the backend
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
  }, [
    autoLaunchRequested,
    roomCode,
    activeTasksetMeta?._id,
    loadedTasksetId,
  ]);

  // Socket listeners
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
          startedAt: null,
          isActive: false,
        };
      setRoomState(safe);

      const entries = Object.entries(safe.scores || {}).sort(
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

      // Append to that team's submissions array
      setSubmissionsByTeam((prev) => {
        const existing = prev[sub.teamId] || [];
        return {
          ...prev,
          [sub.teamId]: [...existing, sub],
        };
      });
    };

    const handleScanEvent = (ev) => {
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

    const handleTranscriptSent = (info) => {
      setSendingReports(false);
      setReportStatus(
        info?.email
          ? `Reports emailed to ${info.email}.`
          : "Reports emailed."
      );
    };

    const handleTranscriptError = (info) => {
      setSendingReports(false);
      setReportStatus(
        (info && info.message) ||
          "There was a problem sending reports."
      );
      console.error("Transcript error:", info);
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("taskSubmission", handleSubmission);
    socket.on("scanEvent", handleScanEvent);
    socket.on("team:joined", handleTeamJoined);
    socket.on("transcript:sent", handleTranscriptSent);
    socket.on("transcript:error", handleTranscriptError);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("tasksetLoaded", handleTasksetLoaded);
      socket.off("taskSubmission", handleSubmission);
      socket.off("scanEvent", handleScanEvent);
      socket.off("team:joined", handleTeamJoined);
      socket.off("transcript:sent", handleTranscriptSent);
      socket.off("transcript:error", handleTranscriptError);
    };
  }, []);

  // Load full TaskSet details for room setup visualization (and timing)
  useEffect(() => {
    if (!loadedTasksetId) {
      setRoomSetupTaskset(null);
      return;
    }

    let cancelled = false;
    setRoomSetupLoading(true);

    api
      .get(`/api/tasksets/${loadedTasksetId}`)
      .then((res) => {
        if (cancelled) return;
        setRoomSetupTaskset(res.data || null);
      })
      .catch((err) => {
        console.error("Failed to load TaskSet for room setup:", err);
        if (!cancelled) {
          setRoomSetupTaskset(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRoomSetupLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadedTasksetId]);

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

    // If it IS already loaded, just launch per-team progression
    socket.emit("launchTaskset", { roomCode: code });
  };

  const handleEndSessionAndEmail = () => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();

    // Choose an email: profile overrides auth user
    const teacherEmail =
      (profile &&
        (profile.reportEmail ||
          profile.email ||
          profile.contactEmail)) ||
      (user && user.email);

    if (!teacherEmail) {
      alert(
        "We couldn't find an email address for you.\n\nPlease set one in your Presenter profile first."
      );
      return;
    }

    // Try a few possible flag names; fall back to false.
    const includeIndividualReports =
      profile?.includeIndividualReports ??
      profile?.includeStudentReports ??
      profile?.studentReportsEnabled ??
      false;

    const assessmentCategories = profile?.assessmentCategories || [];
    const perspectives = profile?.reportPerspectives || [];
    const schoolName = profile?.schoolName || "";

    setSendingReports(true);
    setReportStatus("");
    setReportsAutoTriggered(true); // so we don't auto-trigger again

    socket.emit("teacher:endSessionAndEmail", {
      roomCode: code,
      teacherEmail,
      assessmentCategories,
      includeIndividualReports,
      schoolName,
      perspectives,
    });
  };

  const handleSkipNextTask = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:skipNextTask", { roomCode: code });
  };

  // Derived helpers
  const teamsById = roomState.teams || {};
  const scores = roomState.scores || {};

  let stations = Array.isArray(roomState.stations)
    ? roomState.stations
    : Object.values(roomState.stations || {});

  // If there are no stations yet but there ARE teams,
  // show one pseudo-station card per team so joins are visible.
  if (stations.length === 0 && Object.keys(teamsById).length > 0) {
    stations = Object.keys(teamsById).map((teamId, index) => ({
      id: `Team ${index + 1}`,
      assignedTeamId: teamId,
    }));
  }

  const isFixedStation =
    !!(
      roomSetupTaskset &&
      Array.isArray(roomSetupTaskset.displays) &&
      roomSetupTaskset.displays.length > 0
    );

  // -------- Progress bar calculations (expected vs actual) --------
  const totalTasks =
    (roomSetupTaskset?.tasks && roomSetupTaskset.tasks.length) ||
    activeTasksetMeta?.numTasks ||
    0;

  let totalEstimatedSeconds = 0;
  if (roomSetupTaskset?.tasks && roomSetupTaskset.tasks.length > 0) {
    totalEstimatedSeconds = roomSetupTaskset.tasks.reduce((sum, t) => {
      const sec =
        typeof t.timeLimitSeconds === "number"
          ? t.timeLimitSeconds
          : typeof t.recommendedTimeSeconds === "number"
          ? t.recommendedTimeSeconds
          : 90; // fallback
      return sum + (sec > 0 ? sec : 90);
    }, 0);
  } else if (activeTasksetMeta?.numTasks) {
    // Rough fallback if we don't have full tasks yet
    totalEstimatedSeconds = activeTasksetMeta.numTasks * 90;
  }

  const elapsedSeconds =
    roomState.startedAt && roomState.isActive
      ? Math.max(0, Math.floor((now - roomState.startedAt) / 1000))
      : 0;

  const expectedProgress =
    totalEstimatedSeconds > 0
      ? Math.min(1, elapsedSeconds / totalEstimatedSeconds)
      : 0;

  // Actual progress: average proportion of tasks completed per team
  let actualProgress = 0;
  const teamList = Object.values(teamsById);
  if (totalTasks > 0 && teamList.length > 0) {
    let sumCompleted = 0;
    teamList.forEach((team) => {
      const ti =
        typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : -1;
      // completed tasks is index+1, capped at totalTasks
      const completed = ti + 1;
      const clamped = Math.max(0, Math.min(completed, totalTasks));
      sumCompleted += clamped;
    });
    const avgCompleted = sumCompleted / teamList.length;
    actualProgress = Math.max(0, Math.min(1, avgCompleted / totalTasks));
  }

  const expectedPercent = Math.round(expectedProgress * 100);
  const actualPercent = Math.round(actualProgress * 100);
  const pacingColor =
    actualProgress + 0.01 >= expectedProgress ? "#22c55e" : "#ef4444";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const totalMinutes = totalEstimatedSeconds
    ? Math.round(totalEstimatedSeconds / 60)
    : null;

  // 🔁 Auto-end & auto-email when all teams finished
  useEffect(() => {
    if (reportsAutoTriggered || sendingReports) return;
    if (!roomState.startedAt) return;
    if (!totalTasks) return;

    const teams = Object.values(roomState.teams || {});
    if (!teams.length) return;

    const allFinished = teams.every((team) => {
      const ti =
        typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : -1;
      return ti >= totalTasks; // per-team sendTaskToTeam sets taskIndex to tasks.length on completion
    });

    if (allFinished) {
      handleEndSessionAndEmail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState, totalTasks, reportsAutoTriggered, sendingReports]);

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

    const teamSubs = submissionsByTeam[team.teamId] || [];
    const latest = teamSubs.length
      ? teamSubs[teamSubs.length - 1]
      : null;

    const score = scores[team.teamId] ?? 0;

    const assignedStationId = team.currentStationId || stationId;
    const assignedColor = stationIdToColor(assignedStationId);

    const scannedStationId = team.lastScannedStationId || null;
    const hasScanForThisAssignment =
      scannedStationId && scannedStationId === assignedStationId;

    const currentTaskIndex =
      typeof team.taskIndex === "number"
        ? team.taskIndex
        : roomState.taskIndex;

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

    const bubbleBg =
      hasScanForThisAssignment && assignedColor ? assignedColor : "#f9fafb";
    const textColor =
      hasScanForThisAssignment && assignedColor ? "#ffffff" : "#111827";
    const subtleTextColor =
      hasScanForThisAssignment && assignedColor
        ? "rgba(241,245,249,0.9)"
        : "#6b7280";

    const isCorrect = latest?.correct ?? null;
    const drawerOpen = openSubmissionsTeamId === team.teamId;

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
                  color: hasScanForThisAssignment
                    ? "#bbf7d0"
                    : subtleTextColor,
                  fontStyle: hasScanForThisAssignment ? "normal" : "italic",
                }}
              >
                {statusLine}
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

        {/* Bottom row: colour band + submissions drawer toggle */}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            style={{
              flexGrow: 1,
              height: 6,
              borderRadius: 999,
              backgroundColor: assignedColor
                ? assignedColor
                : "rgba(148,163,184,0.5)",
            }}
          />
          <button
            type="button"
            onClick={() =>
              setOpenSubmissionsTeamId((prev) =>
                prev === team.teamId ? null : team.teamId
              )
            }
            style={{
              flexShrink: 0,
              borderRadius: 999,
              border: "none",
              padding: "3px 8px",
              fontSize: "0.7rem",
              cursor: teamSubs.length ? "pointer" : "default",
              backgroundColor: teamSubs.length
                ? "rgba(15,23,42,0.18)"
                : "rgba(148,163,184,0.3)",
              color: "#f9fafb",
            }}
            disabled={!teamSubs.length}
          >
            {teamSubs.length
              ? drawerOpen
                ? "Hide submissions"
                : `Show submissions (${teamSubs.length})`
              : "No submissions"}
          </button>
        </div>

        {/* Submissions drawer */}
        {drawerOpen && teamSubs.length > 0 && (
          <div
            style={{
              marginTop: 8,
              borderRadius: 8,
              backgroundColor:
                hasScanForThisAssignment && assignedColor
                  ? "rgba(15,23,42,0.15)"
                  : "rgba(15,23,42,0.04)",
              padding: 6,
              maxHeight: 160,
              overflowY: "auto",
              fontSize: "0.75rem",
            }}
          >
            {teamSubs
              .slice()
              .reverse()
              .map((sub, idx) => {
                const isCorrectSub = sub.correct ?? null;
                const label = isCorrectSub
                  ? "✅"
                  : isCorrectSub === false
                  ? "❌"
                  : "•";
                return (
                  <div
                    key={`${sub.taskIndex}-${sub.submittedAt}-${idx}`}
                    style={{
                      padding: "2px 4px",
                      borderBottom:
                        idx === teamSubs.length - 1
                          ? "none"
                          : "1px dashed rgba(148,163,184,0.5)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "65%",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={sub.answerText}
                    >
                      <span style={{ marginRight: 4 }}>{label}</span>
                      <strong>T{(sub.taskIndex ?? 0) + 1}:</strong>{" "}
                      {sub.answerText || "—"}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div>{sub.points ?? 0} pts</div>
                      {sub.timeMs != null && (
                        <div>
                          {(sub.timeMs / 1000).toFixed(1)}s
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
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

          <button
            type="button"
            disabled={!isFixedStation}
            onClick={() => {
              if (isFixedStation) setShowRoomSetup(true);
            }}
            style={{
              marginTop: 8,
              padding: "4px 10px",
              borderRadius: 999,
              border: "none",
              fontSize: "0.8rem",
              cursor: isFixedStation ? "pointer" : "default",
              backgroundColor: isFixedStation ? "#3b82f6" : "#e5e7eb",
              color: isFixedStation ? "#ffffff" : "#9ca3af",
            }}
          >
            View Room Setup
          </button>
          {roomSetupLoading && (
            <div
              style={{
                marginTop: 4,
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              Loading room setup…
            </div>
          )}
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

          {/* End session & email reports */}
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={handleEndSessionAndEmail}
              disabled={sendingReports || !roomState.startedAt}
              style={{
                alignSelf: "flex-start",
                padding: "6px 10px",
                borderRadius: 999,
                border: "none",
                backgroundColor: sendingReports ? "#9ca3af" : "#4f46e5",
                color: "#ffffff",
                fontSize: "0.8rem",
                cursor:
                  sendingReports || !roomState.startedAt
                    ? "default"
                    : "pointer",
                opacity: roomState.startedAt ? 1 : 0.7,
              }}
            >
              {sendingReports
                ? "Sending reports…"
                : "End session & email reports"}
            </button>

            {reportStatus && (
              <div
                style={{
                  fontSize: "0.7rem",
                  color: reportStatus.includes("problem")
                    ? "#b91c1c"
                    : "#4b5563",
                }}
              >
                {reportStatus}
              </div>
            )}

            {!roomState.startedAt && !sendingReports && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: "0.7rem",
                  color: "#9ca3af",
                }}
              >
                Start a session and run at least one task to enable
                reports.
              </div>
            )}
          </div>

          {/* Progress bars + skip button */}
          {totalTasks > 0 && (
            <div
              style={{
                marginTop: 4,
                paddingTop: 8,
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#4b5563",
                  }}
                >
                  Time:{" "}
                  {totalMinutes != null
                    ? `${elapsedMinutes}/${totalMinutes} min`
                    : `${elapsedMinutes} min`}
                </div>
                <button
                  type="button"
                  onClick={handleSkipNextTask}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "none",
                    background: "#f97316",
                    color: "#ffffff",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  Skip next task
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {/* Expected progress (time-based) */}
                <div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6b7280",
                      marginBottom: 2,
                    }}
                  >
                    By time ({expectedPercent}%)
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: "#e5e7eb",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${expectedPercent}%`,
                        height: "100%",
                        backgroundColor: "#3b82f6",
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                </div>

                {/* Actual progress (team completion) */}
                <div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6b7280",
                      marginBottom: 2,
                    }}
                  >
                    Actual ({actualPercent}%)
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: "#e5e7eb",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${actualPercent}%`,
                        height: "100%",
                        backgroundColor: pacingColor,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
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
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                {leaderboard.map(([teamId, pts]) => {
                  const team = teamsById[teamId];
                  const teamName =
                    team?.teamName ||
                    team?.displayName ||
                    `Team-${String(teamId).slice(-4)}`;

                  const members = Array.isArray(team?.members)
                    ? team.members.filter(Boolean)
                    : [];

                  const membersLabel = members.length
                    ? ` (${members.join(", ")})`
                    : "";

                  return (
                    <li key={teamId} style={{ marginBottom: 4 }}>
                      <strong>
                        {teamName}
                        {membersLabel}
                      </strong>{" "}
                      — {pts} pts
                    </li>
                  );
                })}
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

      {/* Room setup overlay */}
      {showRoomSetup && isFixedStation && roomSetupTaskset && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 12,
              padding: 16,
              maxWidth: 900,
              width: "90%",
              maxHeight: "90vh",
              boxShadow: "0 10px 40px rgba(15,23,42,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1rem",
                }}
              >
                Room setup
              </h2>
              <button
                type="button"
                onClick={() => setShowRoomSetup(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "1.1rem",
                  cursor: "pointer",
                  padding: 4,
                  lineHeight: 1,
                  color: "#4b5563",
                }}
              >
                ✕
              </button>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              {roomSetupTaskset?.name && (
                <>
                  Task set: <strong>{roomSetupTaskset.name}</strong>
                </>
              )}
              {roomSetupTaskset?.roomLocation && (
                <>
                  {" "}
                  • Room: {roomSetupTaskset.roomLocation}
                </>
              )}
            </p>

            {/* Classroom rectangle with stations around the perimeter */}
            <div
              style={{
                marginTop: 8,
                flex: 1,
                minHeight: 260,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  maxWidth: 700,
                  aspectRatio: "4 / 3",
                  border: "2px solid #e5e7eb",
                  borderRadius: 16,
                  backgroundColor: "#f9fafb",
                  overflow: "hidden",
                  padding: 16,
                }}
              >
                {/* Inner dashed rectangle to suggest the room interior */}
                <div
                  style={{
                    position: "absolute",
                    inset: "20%",
                    borderRadius: 12,
                    border: "2px dashed #cbd5e1",
                    backgroundColor: "rgba(255,255,255,0.85)",
                  }}
                />

                {Array.isArray(roomSetupTaskset.displays) &&
                  roomSetupTaskset.displays.map((disp, index) => {
                    const count =
                      roomSetupTaskset.displays.length || 1;
                    const angle = (2 * Math.PI * index) / count;
                    const radius = 38; // percent from centre
                    const x = 50 + radius * Math.cos(angle);
                    const y = 50 + radius * Math.sin(angle);

                    return (
                      <div
                        key={index}
                        style={{
                          position: "absolute",
                          top: `${y}%`,
                          left: `${x}%`,
                          transform: "translate(-50%, -50%)",
                          borderRadius: 9999,
                          padding: "6px 10px",
                          backgroundColor: "#e0f2fe",
                          border: "1px solid #38bdf8",
                          fontSize: "0.75rem",
                          maxWidth: 180,
                          textAlign: "center",
                          boxShadow:
                            "0 2px 4px rgba(15,23,42,0.2)",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            marginBottom: disp.description ? 2 : 0,
                          }}
                        >
                          {disp.name ||
                            disp.stationColor ||
                            `Station ${index + 1}`}
                        </div>
                        {disp.description && (
                          <div
                            style={{
                              opacity: 0.95,
                            }}
                          >
                            {disp.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              Each bubble represents a fixed station placed around the
              perimeter of the classroom.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
