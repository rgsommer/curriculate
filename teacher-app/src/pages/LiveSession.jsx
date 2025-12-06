// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useState, useRef } from "react";
import { socket } from "../socket";
import { fetchMyProfile } from "../api/profile";
import { TASK_TYPES } from "../../../shared/taskTypes.js";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL || "";

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
    // NEW: brainstorm battle summary from backend
    brainstorm: null,
  });

  const [submissions, setSubmissions] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);
  const [teamOrder, setTeamOrder] = useState([]);

  const [isLaunchingQuick, setIsLaunchingQuick] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [teacherRooms, setTeacherRooms] = useState([]);

  // NEW dynamic system — only these
  const [taskType, setTaskType] = useState("TEXT");
  const [taskConfig, setTaskConfig] = useState({});
  const [showAiGen, setShowAiGen] = useState(false);

  const [aiGrade, setAiGrade] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [aiPurpose, setAiPurpose] = useState("");
  const [aiSubject, setAiSubject] = useState("");
  const [aiWordList, setAiWordList] = useState("");

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

  const isFixedStationTaskset =
    !!activeTasksetMeta?.isFixedStationTaskset ||
    activeTasksetMeta?.deliveryMode === "fixed-stations" ||
    activeTasksetMeta?.mode === "fixed-stations";

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

  // Location override (multi-room presets from Presenter Profile)
  const [locationOptions, setLocationOptions] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);

  // Hide & Seek launch-time clues
  const [hideNSeekTasks, setHideNSeekTasks] = useState([]);
  const [hideNSeekClues, setHideNSeekClues] = useState({});
  const [showHideNSeekModal, setShowHideNSeekModal] = useState(false);
  const [pendingHideTaskset, setPendingHideTaskset] = useState(null);
  const [launchingTaskset, setLaunchingTaskset] = useState(false);

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

  useEffect(() => {
    async function loadTeacherRooms() {
      const profile = await fetchMyProfile();
      setTeacherRooms(profile.locationOptions || []);

      // Optional: use profile.treatsPerSession as the default treat quota
      if (profile && typeof profile.treatsPerSession !== "undefined") {
        const n = Number(profile.treatsPerSession);
        if (Number.isFinite(n)) {
          setTreatsConfig((prev) => ({
            ...prev,
            total: n,
          }));
        }
      }
    }
    loadTeacherRooms();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPresenterLocations() {
      try {
        const data = await fetchMyProfile();
        if (cancelled || !data) return;

        if (Array.isArray(data.locationOptions) && data.locationOptions.length) {
          setLocationOptions(
            data.locationOptions.map((s) => (s || "").toString().trim()).filter(Boolean)
          );
        }
      } catch (err) {
        console.error(
          "[LiveSession] Failed to load presenter profile for locations:",
          err
        );
      }
    }

    loadPresenterLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----------------------------------------------------
  // Create the room whenever roomCode changes
  // ----------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;

    const code = roomCode.toUpperCase();
    setStatus("Connecting…");

    socket.emit("teacher:createRoom", { roomCode: code });

    // We do NOT need to join as a student/team here.
    setStatus("Connected.");
  }, [roomCode]);

  // Clear any old "launch immediately" flag – we now require
  // an explicit click on "Launch from taskset" in LiveSession.
  useEffect(() => {
    localStorage.removeItem("curriculateLaunchImmediately");
  }, []);

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
        // NEW: brainstorm summary from backend
        brainstorm: state.brainstorm || null,
      }));

      if (!selectedLocation && state.locationCode) {
        setSelectedLocation((prev) => prev || state.locationCode);
      }

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

      if (
        launchAfterLoad &&
        activeTasksetMeta &&
        payload?.tasksetId === activeTasksetMeta._id &&
        roomCode
      ) {
        const code = roomCode.toUpperCase();
        setStatus("Launching first task…");

        socket.emit("teacher:launchNextTask", {
          roomCode: code,
          selectedRooms,
        });
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

    // Transcript result events from backend
    const handleTranscriptSent = (payload) => {
      handleEndSessionAck({ ok: true, ...payload });
    };
    const handleTranscriptError = (payload) => {
      handleEndSessionAck({
        ok: false,
        error: payload?.message,
      });
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("taskSubmission", handleSubmission);
    socket.on("teamJoined", handleTeamJoined);
    socket.on("scanEvent", handleScanEvent);
    socket.on("teacher:roomSetup", handleRoomSetup);
    socket.on("session:noiseLevel", handleNoiseLevel);
    socket.on("teacher:treatAssigned", handleTreatAssigned);

    socket.on("transcript:sent", handleTranscriptSent);
    socket.on("transcript:error", handleTranscriptError);

    socket.on("team-update", (data) => {
      console.log("Team update received:", data);
      setRoomState((prev) => ({
        ...prev,
        teams: {
          ...prev.teams,
          [data.teamId]: data,
        },
      }));
    });

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("tasksetLoaded", handleTasksetLoaded);
      socket.off("taskSubmission", handleSubmission);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("scanEvent", handleScanEvent);
      socket.off("teacher:roomSetup", handleRoomSetup);
      socket.off("session:noiseLevel", handleNoiseLevel);
      socket.off("teacher:treatAssigned", handleTreatAssigned);

      socket.off("transcript:sent", handleTranscriptSent);
      socket.off("transcript:error", handleTranscriptError);

      socket.off("team-update");
    };
  }, [
    roomCode,
    noiseLevel,
    noiseBrightness,
    launchAfterLoad,
    activeTasksetMeta,
    selectedLocation,
    noiseThreshold,
  ]);

  // ----------------------------------------------------
  // Actions
  // ----------------------------------------------------
  const handleSkipTask = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:skipNextTask", { roomCode: code });
  };

  const handleOpenQrSheets = () => {
    const base = window.location.origin.replace(/\/$/, "");
    const code = (roomCode || "").toUpperCase();
    const locationLabel =
      selectedLocation || roomState.locationCode || "Classroom";

    const stationCount =
      (roomSetup &&
        Array.isArray(roomSetup.stations) &&
        roomSetup.stations.length) ||
      COLORS.length;

    const params = new URLSearchParams();
    if (code) params.set("room", code);
    if (locationLabel) params.set("location", locationLabel);
    if (stationCount) params.set("stations", String(stationCount));

    const url = `${base}/station-posters?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleShowRoomLayoutClick = () => {
    if (!isFixedStationTaskset) return;
    setShowRoomSetup(true);
  };

  const handleLaunchQuickTask = () => {
    if (!taskConfig.prompt?.trim()) return;

    setIsLaunchingQuick(true);

    const taskToSend = {
      taskType,
      prompt: taskConfig.prompt.trim(),
      ...(taskConfig.correctAnswer && { correctAnswer: taskConfig.correctAnswer.trim() }),
      ...(taskConfig.options && { options: taskConfig.options }),
      ...(taskConfig.clue && { clue: taskConfig.clue.trim() }),
    };

    socket.emit("teacherLaunchTask", {
      roomCode: roomCode.toUpperCase(),
      task: taskToSend,
      selectedRooms: selectedRooms.length > 0 ? selectedRooms : undefined,
    });

    // Reset form
    setTimeout(() => {
      setTaskConfig({});
      setTaskType("TEXT");
      setIsLaunchingQuick(false);
      setStatus("Quick task launched!");
    }, 300);
  };

  const handleLocationOverrideClick = (loc) => {
    setSelectedLocation(loc);
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("teacher:setLocationOverride", {
      roomCode: code,
      locationCode: loc,
    });
  };

  const handleGenerateQuickTask = async () => {
    if (!roomCode) {
      alert("You must have a room code to generate a task.");
      return;
    }

    setIsGenerating(true);
    setAiError(null);

    try {
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;

      const payload = {
        // Safe defaults to satisfy the backend
        title: "Quick Room Task",
        description: aiPurpose || "",

        numTasks: 1,
        taskType,                     // e.g. "MCQ", "TEXT", etc.

        grade: aiGrade || undefined,  // optional
        difficulty: aiDifficulty || "medium",
        subject: aiSubject || undefined,

        wordList: aiWordList || undefined,
        roomCode: roomCode.toUpperCase(),
        mode: "quick-live-session",   // extra context, backend can ignore
      };

      const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data = text ? JSON.parse(text) : null;

      if (!res.ok) {
        throw new Error(
          data?.error || `AI generator error (${res.status})`
        );
      }

      // Expect a single-task taskset back
      const taskset = data?.taskset || data;
      const firstTask =
        taskset?.tasks?.[0] || (Array.isArray(data?.tasks) ? data.tasks[0] : null);

      if (!firstTask) {
        throw new Error("AI did not return a task.");
      }

      // Normalise into your quick-task config
      const generatedType =
        firstTask.taskType || firstTask.task_type || taskType;

      setTaskType(generatedType);
      setTaskConfig({
        prompt: firstTask.prompt || "",
        correctAnswer: firstTask.correctAnswer || "",
        options: firstTask.options || [],
        clue: firstTask.clue || "",
      });

      setShowAiGen(false);
    } catch (err) {
      console.error("AI Quick Task error:", err);
      setAiError(err.message || "AI generation failed.");
      alert(err.message || "AI generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLaunchTaskset = async () => {
    if (!roomCode || !activeTasksetMeta?._id) return;
    const code = roomCode.toUpperCase();

    // If we can, pre-load the full taskset to check for HideNSeek tasks
    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : null;

    setLaunchingTaskset(true);
    setStatus("Preparing taskset…");

    try {
      const res = await fetch(`${API_BASE}/api/tasksets/${activeTasksetMeta._id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("Server returned invalid JSON while loading set for launch");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load taskset before launch");
      }

      const tasks = Array.isArray(data.tasks) ? data.tasks : [];

      // Build a list of HideNSeek tasks that still need a clue/page reference
      const hideTasks = tasks
        .map((t, idx) => ({ task: t, index: idx }))
        .filter(
          ({ task }) =>
            task &&
            (task.taskType === TASK_TYPES.HIDENSEEK ||
              task.taskType === "hidenseek") &&
            (!task.clue || !String(task.clue).trim())
        );

      if (hideTasks.length > 0) {
        // Prepare a modal asking the teacher to enter the page reference / clue
        const initialClues = {};
        hideTasks.forEach(({ task, index }) => {
          initialClues[String(index)] = task.clue || "";
        });

        setHideNSeekTasks(hideTasks);
        setHideNSeekClues(initialClues);
        setPendingHideTaskset({ data, roomCode: code });
        setShowHideNSeekModal(true);
        setStatus("Enter Hide & Seek page references before launching.");
        setLaunchingTaskset(false);
        return;
      }

      // No HideNSeek tasks missing clues – launch normally
      setStatus("Loading taskset…");
      setLaunchAfterLoad(true);

      socket.emit("loadTaskset", {
        roomCode: code,
        tasksetId: data._id || activeTasksetMeta._id,
        selectedRooms,
      });
    } catch (err) {
      console.error("[LiveSession] Launch taskset error:", err);
      setStatus(err.message || "Failed to launch taskset.");
    } finally {
      // If we showed the modal, we already set launchingTaskset to false above
      setLaunchingTaskset(false);
    }
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

    socket.emit("teacher:updateNoiseControl", {
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

    socket.emit("teacher:updateNoiseControl", {
      roomCode: code,
      enabled: noiseEnabled,
      threshold: value,
    });
  };

  // --- NEW: Brainstorm Battle controls ---
  const handleStartBrainstorm = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    const idx =
      typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
        ? roomState.taskIndex
        : 0;

    socket.emit("brainstorm:start", {
      roomCode: code,
      taskIndex: idx,
    });
    setStatus("Brainstorm Battle started.");
  };

  const handleResetBrainstorm = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();
    const idx =
      typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
        ? roomState.taskIndex
        : 0;

    socket.emit("brainstorm:reset", {
      roomCode: code,
      taskIndex: idx,
    });
    setStatus("Brainstorm Battle reset.");
  };

  // ----------------------------------------------------
  // Derived helpers + button state
  // ----------------------------------------------------
  const teams = roomState.teams || {};
  const teamIdsForGrid = teamOrder.filter((id) => teams[id]);
  const taskFlowActive =
    typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0;

  // --- Treat gating: require at least 30% of tasks completed ---
  const minTasksBeforeTreat =
    typeof totalTasksInActiveSet === "number" && totalTasksInActiveSet > 0
      ? Math.ceil(totalTasksInActiveSet * 0.3) // 30% of tasks, rounded up
      : 0;

  // We approximate "tasks completed" from the current (0-based) taskIndex:
  // index 0 → 0 completed, 1 → 1 completed, etc.
  const tasksCompletedSoFar =
    typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
      ? roomState.taskIndex
      : 0;

  const treatsUnlocked =
    minTasksBeforeTreat === 0 || tasksCompletedSoFar >= minTasksBeforeTreat;

  const canGiveTreat =
    treatsUnlocked &&
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

  // Brainstorm battle derived view
  const brainstorm = roomState.brainstorm;
  const brainstormTeams = brainstorm?.teams
    ? Object.values(brainstorm.teams).sort((a, b) => b.ideaCount - a.ideaCount)
    : [];

  const launchBtnLabelDefault = "Launch from taskset";
  let launchBtnLabel = launchBtnLabelDefault;
  let launchBtnBg = "#10b981"; // green
  let launchBtnOnClick = handleLaunchTaskset;
  let launchBtnDisabled = !activeTasksetMeta;

  if (!activeTasksetMeta) {
    launchBtnDisabled = true;
    launchBtnBg = "#9ca3af";
    launchBtnLabel = launchBtnLabelDefault;
    launchBtnOnClick = null;
  } else if (taskFlowActive) {
    launchBtnLabel = "End Task Session & Generate Reports";
    launchBtnBg = "#dc2626";
    launchBtnOnClick = handleEndSessionAndEmail;
    launchBtnDisabled = isEndingSession;
  } else if (launchAfterLoad) {
    launchBtnLabel = "Launching taskset…";
    launchBtnBg = "#10b981";
    launchBtnOnClick = null;
    launchBtnDisabled = true;
  } else if (launchingTaskset) {
    launchBtnLabel = "Preparing Hide & Seek…";
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

        {!taskFlowActive && lastScan && (
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
              : "–"}
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
        {(selectedLocation || roomState.locationCode) && (
          <div
            style={{
              fontSize: "0.85rem",
              padding: "4px 10px",
              borderRadius: 999,
              background: "#eff6ff",
              color: "#1d4ed8",
            }}
          >
            Location: {selectedLocation || roomState.locationCode}
          </div>
        )}
      </header>

      {/* Location override selection */}
      {locationOptions.length > 0 && (
        <div
          style={{
            marginTop: 8,
            marginBottom: 4,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "0.8rem",
              color: "#4b5563",
            }}
          >
            Location override:
          </span>
          {locationOptions.map((loc) => {
            const active =
              (selectedLocation || roomState.locationCode) === loc;
            return (
              <button
                key={loc}
                type="button"
                onClick={() => handleLocationOverrideClick(loc)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: active ? "none" : "1px solid #d1d5db",
                  background: active ? "#0ea5e9" : "#f9fafb",
                  color: active ? "#fff" : "#374151",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {loc}
              </button>
            );
          })}
        </div>
      )}

          {/* Main layout: left = controls, middle = teams, right = leaderboard/scan */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          minHeight: 0,
          flexDirection: isNarrow ? "column" : "row",
          alignItems: "stretch",
        }}
      >
        {/* LEFT 1/3: Task controls + Noise/Treats */}
        <div
          style={{
            flex: 1,
            minWidth: isNarrow ? "100%" : 0,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Task controls (Quick task + Taskset launch + QR + Room layout) */}
          <div
            style={{
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

            {/* Quick task – fully dynamic */}
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                background: "#f8fafc",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Quick Launch Task
              </div>

              <p
                style={{
                  margin: 0,
                  marginBottom: 8,
                  fontSize: "0.8rem",
                  color: "#4b5563",
                }}
              >
                Use <strong>Generate Task</strong> to prepare a question, then
                tap <strong>Launch Task</strong>.
              </p>

              {taskConfig.prompt ? (
                <div
                  style={{
                    marginBottom: 8,
                    padding: 8,
                    borderRadius: 8,
                    background: "#e0f2fe",
                    border: "1px solid #bae6fd",
                    fontSize: "0.8rem",
                    color: "#0f172a",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 4,
                      fontSize: "0.8rem",
                    }}
                  >
                    Ready to launch:
                  </div>
                  <div>{taskConfig.prompt}</div>
                </div>
              ) : (
                <div
                  style={{
                    marginBottom: 8,
                    padding: 8,
                    borderRadius: 8,
                    background: "#f1f5f9",
                    border: "1px dashed #cbd5e1",
                    fontSize: "0.8rem",
                    color: "#64748b",
                  }}
                >
                  No quick task prepared yet. Click{" "}
                  <strong>Generate Task</strong> to create one.
                </div>
              )}

              {/* Multi-room selector (still available for supported types) */}
              {(taskType === "HIDENSEEK" || taskType === "BRAIN_STORM") &&
                teacherRooms.length > 1 && (
                  <div style={{ marginTop: 4, marginBottom: 8 }}>
                    <label style={{ fontSize: "0.8rem" }}>
                      Send to rooms:
                    </label>
                    <select
                      multiple
                      size={3}
                      value={selectedRooms}
                      onChange={(e) =>
                        setSelectedRooms(
                          Array.from(e.target.selectedOptions, (o) => o.value)
                        )
                      }
                      style={{
                        width: "100%",
                        padding: 6,
                        borderRadius: 8,
                        marginTop: 4,
                      }}
                    >
                      {teacherRooms.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={handleLaunchQuickTask}
                  disabled={!taskConfig.prompt?.trim()}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: 999,
                    background: taskConfig.prompt?.trim()
                      ? "#0ea5e9"
                      : "#94a3b8",
                    color: "white",
                    border: "none",
                    fontWeight: 600,
                    cursor: taskConfig.prompt?.trim()
                      ? "pointer"
                      : "not-allowed",
                  }}
                >
                  {isLaunchingQuick ? "Launching…" : "Launch Task"}
                </button>

                <button
                  onClick={() => setShowAiGen(true)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "#6366f1",
                    color: "white",
                    border: "none",
                    fontSize: "0.85rem",
                  }}
                >
                  Generate Task
                </button>
              </div>
            </div>

            {/* QR sheets + Room layout */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 4,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleOpenQrSheets}
                disabled={!roomCode}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #d1d5db",
                  background: "#f9fafb",
                  fontSize: "0.8rem",
                  cursor: roomCode ? "pointer" : "not-allowed",
                }}
              >
                Print QR Station Sheets
              </button>

              <button
                type="button"
                title="Room Layout for Fixed-Station task sets"
                onClick={handleShowRoomLayoutClick}
                disabled={!isFixedStationTaskset}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #d1d5db",
                  background: isFixedStationTaskset ? "#f9fafb" : "#f3f4f6",
                  color: isFixedStationTaskset ? "#111827" : "#9ca3af",
                  fontSize: "0.8rem",
                  cursor: isFixedStationTaskset ? "pointer" : "not-allowed",
                }}
              >
                Room Layout
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

          {/* Noise & Treats Controls */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Noise Control */}
            <section aria-labelledby="noise-control-title">
              <h3
                id="noise-control-title"
                style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}
              >
                Noise Control
              </h3>

              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: "0.875rem", color: "#374151" }}>
                  Mode: <strong>{noiseLabel}</strong>
                </span>
                <button
                  onClick={handleToggleNoise}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "none",
                    background: noiseEnabled ? "#22c55e" : "#e5e7eb",
                    color: noiseEnabled ? "white" : "#374151",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {noiseEnabled ? "On" : "Off"}
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={noiseThreshold}
                  onChange={handleNoiseThresholdChange}
                  style={{
                    width: "100%",
                    height: 8,
                    borderRadius: 4,
                    background: "#e5e7eb",
                    outline: "none",
                    appearance: "none",
                  }}
                  aria-label="Noise sensitivity threshold"
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: "0.8rem",
                    color: "#6b7280",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Live level: {noiseLevel}</span>
                  <span>
                    Brightness:{" "}
                    {noiseEnabled ? noiseBrightness.toFixed(2) : "1.00"}
                  </span>
                </div>
              </div>
            </section>

            {/* Treats */}
            <section aria-labelledby="treats-title">
              <h3
                id="treats-title"
                style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}
              >
                Treats
              </h3>

              <p
                style={{
                  margin: "8px 0",
                  fontSize: "0.875rem",
                  color: "#374151",
                }}
              >
                {treatsConfig.enabled ? (
                  <>
                    {treatsConfig.given} of {treatsConfig.total} treats given
                  </>
                ) : (
                  <>Treats are currently disabled</>
                )}
              </p>

              <button
                onClick={handleGiveTreat}
                disabled={!canGiveTreat}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: 999,
                  border: "none",
                  background: canGiveTreat ? "#f97316" : "#fca5a5",
                  color: "white",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: canGiveTreat ? "pointer" : "not-allowed",
                  opacity: canGiveTreat ? 1 : 0.6,
                  transition: "all 0.2s",
                }}
              >
                {canGiveTreat ? "Give Random Treat" : "Treats Locked"}
              </button>

              {treatsConfig.enabled &&
                !treatsUnlocked &&
                totalTasksInActiveSet > 0 && (
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: "0.8rem",
                      color: "#6b7280",
                      lineHeight: 1.4,
                    }}
                  >
                    Treats unlock after completing{" "}
                    <strong>{minTasksBeforeTreat}</strong> of{" "}
                    <strong>{totalTasksInActiveSet}</strong> tasks.
                  </p>
                )}
            </section>
          </div>
        </div>

        {/* MIDDLE 1/3: Teams grid */}
        <div
          style={{
            flex: 1,
            minWidth: isNarrow ? "100%" : 0,
          }}
        >
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

        {/* RIGHT 1/3: Leaderboard + Scan log */}
        <div
          style={{
            flex: 1,
            minWidth: isNarrow ? "100%" : 0,
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

          {/* Scan log – only when no task is active */}
          {!taskFlowActive && (
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
                  fontSize: "0.8rem",
                  color: "#374151",
                }}
              >
                {scanEvents.length === 0 ? (
                  <div
                    style={{ fontStyle: "italic", color: "#9ca3af" }}
                  >
                    No scans yet.
                  </div>
                ) : (
                  scanEvents.map((entry, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      <span>
                        {entry.teamName || entry.teamId || "Team"} scanned{" "}
                        {entry.stationLabel ||
                          entry.stationId ||
                          "station"}{" "}
                        at{" "}
                        {entry.timestamp
                          ? new Date(
                              entry.timestamp
                            ).toLocaleTimeString()
                          : "–"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {showHideNSeekModal && pendingHideTaskset && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
          onClick={() => {
            setShowHideNSeekModal(false);
            setHideNSeekTasks([]);
            setHideNSeekClues({});
            setPendingHideTaskset(null);
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: 16,
              maxWidth: 520,
              width: "90%",
              maxHeight: "80vh",
              boxShadow: "0 20px 40px rgba(15,23,42,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 600,
              }}
            >
              Hide &amp; Seek set-up: page references
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              For each Hide &amp; Seek task in this set, enter the page
              reference or description of what students must find. This becomes
              the clue shown on their screens.
            </p>

            <div
              style={{
                marginTop: 8,
                paddingRight: 4,
                overflowY: "auto",
                maxHeight: 260,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {hideNSeekTasks.map(({ task, index }, idx) => (
                <div
                  key={task._id || task.id || index}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    padding: 8,
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: "#6b7280",
                      marginBottom: 2,
                    }}
                  >
                    Task {idx + 1}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      marginBottom: 4,
                      color: "#111827",
                    }}
                  >
                    {task.title || "Hide & Seek task"}
                  </div>
                  <textarea
                    value={hideNSeekClues[String(index)] ?? ""}
                    onChange={(e) =>
                      setHideNSeekClues((prev) => ({
                        ...prev,
                        [String(index)]: e.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="e.g., 'Find the painting on p. 183 that shows Wolfe on the Plains of Abraham and explain why the dog is included.'"
                    style={{
                      width: "100%",
                      resize: "vertical",
                      borderRadius: 8,
                      border: "1px solid #cbd5f5",
                      padding: 6,
                      fontSize: "0.8rem",
                    }}
                  />
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowHideNSeekModal(false);
                  setHideNSeekTasks([]);
                  setHideNSeekClues({});
                  setPendingHideTaskset(null);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #d1d5db",
                  background: "#f9fafb",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={hideNSeekTasks.some(
                  ({ index }) =>
                    !hideNSeekClues[String(index)] ||
                    !hideNSeekClues[String(index)].trim()
                )}
                onClick={async () => {
                  if (!pendingHideTaskset || !pendingHideTaskset.data) return;

                  const token =
                    typeof window !== "undefined"
                      ? localStorage.getItem("token")
                      : null;

                  const tasksetDoc = pendingHideTaskset.data;
                  const originalTasks = Array.isArray(tasksetDoc.tasks)
                    ? tasksetDoc.tasks
                    : [];

                  const updatedTasks = originalTasks.map((t, idx) => {
                    const clue = hideNSeekClues[String(idx)];
                    if (
                      (t.taskType === TASK_TYPES.HIDENSEEK ||
                        t.taskType === "hidenseek") &&
                      clue &&
                      clue.trim()
                    ) {
                      return {
                        ...t,
                        clue: clue.trim(),
                      };
                    }
                    return t;
                  });

                  try {
                    setLaunchingTaskset(true);
                    setStatus("Saving Hide & Seek clues…");

                    const res = await fetch(
                      `${API_BASE}/api/tasksets/${
                        tasksetDoc._id || activeTasksetMeta?._id
                      }`,
                      {
                        method: "PUT",
                        headers: {
                          "Content-Type": "application/json",
                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        body: JSON.stringify({
                          name:
                            tasksetDoc.name ||
                            activeTasksetMeta?.name ||
                            "Untitled set",
                          description: tasksetDoc.description || "",
                          tasks: updatedTasks,
                          displays: tasksetDoc.displays || [],
                          ownerId:
                            tasksetDoc.ownerId || tasksetDoc.userId || null,
                        }),
                      }
                    );

                    const text = await res.text();
                    let data = null;
                    try {
                      data = text ? JSON.parse(text) : null;
                    } catch {
                      throw new Error(
                        "Server returned invalid JSON while saving Hide & Seek clues"
                      );
                    }

                    if (!res.ok) {
                      throw new Error(
                        data?.error ||
                          "Failed to save Hide & Seek clues before launch"
                      );
                    }

                    setShowHideNSeekModal(false);
                    setHideNSeekTasks([]);
                    setHideNSeekClues({});
                    setPendingHideTaskset(null);

                    // Now we can launch the taskset as normal
                    const codeToUse =
                      pendingHideTaskset.roomCode ||
                      (roomCode ? roomCode.toUpperCase() : null);

                    if (codeToUse) {
                      setStatus("Loading taskset…");
                      setLaunchAfterLoad(true);
                      socket.emit("loadTaskset", {
                        roomCode: codeToUse,
                        tasksetId:
                          data._id ||
                          tasksetDoc._id ||
                          activeTasksetMeta?._id,
                        selectedRooms,
                      });
                    }
                  } catch (err) {
                    console.error("[LiveSession] Hide & Seek save error:", err);
                    setStatus(
                      err.message ||
                        "Failed to save Hide & Seek clues before launch."
                    );
                  } finally {
                    setLaunchingTaskset(false);
                  }
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "none",
                  background: "#0ea5e9",
                  color: "#ffffff",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  opacity: hideNSeekTasks.some(
                    ({ index }) =>
                      !hideNSeekClues[String(index)] ||
                      !hideNSeekClues[String(index)].trim()
                  )
                    ? 0.5
                    : 1,
                }}
              >
                Start set
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* AI GENERATOR MODAL */}
      {showAiGen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,   // ← highest z-index in the file
          }}
          onClick={() => {
            setShowAiGen(false);
            setAiGrade("");
            setAiDifficulty("medium");
            setAiPurpose("");
            setAiSubject("");
            setAiWordList("");
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 16,
              padding: 24,
              width: "90%",
              maxWidth: 520,
              boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: "1.25rem" }}>
              Generate Task with AI
            </h3>
            <p style={{ margin: "0 0 16px 0", color: "#64748b", fontSize: "0.9rem" }}>
              Fill in as much as you want — we will create a perfect task for you.
            </p>

                        <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Task type selection moved into the modal */}
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              >
                {Object.entries(TASK_TYPES).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label || key}
                  </option>
                ))}
              </select>

              <input
                placeholder="Grade / Year level (e.g. Grade 6)"
                value={aiGrade}
                onChange={(e) => setAiGrade(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />

              <select
                value={aiDifficulty}
                onChange={(e) => setAiDifficulty(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>

              <input
                placeholder="Learning objective / purpose"
                value={aiPurpose}
                onChange={(e) => setAiPurpose(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />

              <input
                placeholder="Subject (e.g. Science, History)"
                value={aiSubject}
                onChange={(e) => setAiSubject(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />

              <textarea
                rows={3}
                placeholder="Word list or key terms (comma-separated, optional)"
                value={aiWordList}
                onChange={(e) => setAiWordList(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => {
                  setShowAiGen(false);
                  setAiGrade("");
                  setAiDifficulty("medium");
                  setAiPurpose("");
                  setAiSubject("");
                  setAiWordList("");
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 999,
                  border: "1px solid #94a3b8",
                  background: "transparent",
                  color: "#475569",
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    onClick={handleGenerateQuickTask}
                      disabled={isGenerating}
                    >
                    setStatus("Generating with AI…");
                    const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({
                        numTasks: 1,
                        taskType,
                        grade: aiGrade || undefined,
                        difficulty: aiDifficulty,
                        purpose: aiPurpose || undefined,
                        subject: aiSubject || undefined,
                        words: aiWordList
                          .split(",")
                          .map((w) => w.trim())
                          .filter(Boolean),
                      }),
                    });

                    if (!res.ok) throw new Error("Failed");

                    const data = await res.json();
                    const generated = data.tasks?.[0];

                    if (generated) {
                      setTaskType(generated.task_type || taskType);
                      setTaskConfig({
                        prompt: generated.prompt || "",
                        correctAnswer: generated.correctAnswer || "",
                        options: generated.options || [],
                        clue: generated.clue || "",
                      });
                      setStatus("Task ready! Edit if needed, then Launch.");
                    }
                  } catch (err) {
                    console.error(err);
                    setStatus("Task generation failed.");
                  } finally {
                    setShowAiGen(false);
                  }
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  background: "#4f46e5",
                  color: "white",
                  border: "none",
                  fontWeight: 600,
                }}
              >
                Generate Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}