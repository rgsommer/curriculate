// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import QrScanner from "./components/QrScanner.jsx";
import NoiseSensor from "./components/NoiseSensor.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import MoodCheckInTask from "./components/tasks/types/MoodCheckInTask";
import TeamSelfieTask from "./components/tasks/types/TeamSelfieTask";
import TreasureRunner from "./components/tasks/types/TreasureRunnerTask";
import MultiPlayerFeedbackTask from "./components/tasks/types/MultiPlayerFeedbackTask.jsx";

import MysteryBoxGrid from "./components/MysteryBoxGrid.jsx";
import { API_BASE_URL } from "./config.js";
import FeedbackButton from "./components/FeedbackButton.jsx";
import { COLORS } from "@shared/colors.js";
import AnimatedLeaderboard from "./components/Leaderboard.jsx";
import AnimatedScore from "./components/ui/AnimatedScore.jsx";
import ThemeBackground from "./components/ui/ThemeBackground.jsx";
import { THEMES } from "./utils/themeHelpers.js";

// Utilities
import {
  normalizeLocationSlug,
  normalizeStationId,
  titleCaseRoom,
  displayRoomFromSlugOrLabel,
  getStationBubbleStyles,
} from "./utils/stationHelpers.js";
import {
  LS_KEYS,
  lsGet,
  lsSet,
  lsDel,
  clearSavedJoin,
} from "./utils/localStorage.js";
import {
  isObjectiveTask,
  getItemPrompt,
  tfCorrectToText,
  buildObjectiveAnswerKey,
} from "./utils/answerKeyHelpers.js";
import { buildMatchingReveal } from "./utils/matchingReveal.js";
import { getThemeShell, getThemeMode, formatRemainingMs } from "./utils/themeHelpers.js";
import ThemeModeContext from "./utils/ThemeModeContext.js";

// Hooks
import { useSocketConnection } from "./hooks/useSocketConnection.js";
import { useSoundEffects } from "./hooks/useSoundEffects.js";

// Build marker so you can confirm the deployed bundle
const BUILD_MARKER = import.meta.env.VITE_BUILD_ID;
console.log("StudentApp Build:", BUILD_MARKER);

// For now, LiveSession-launched tasks are assumed to use "Classroom"
const DEFAULT_LOCATION = "Classroom";

// Cap emoji/symbol usage in names to prevent spammy display names.
// Allows up to `max` emoji/symbols; strips extras while keeping all regular text.
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
function capEmojis(str, max = 2) {
  let count = 0;
  return str.replace(EMOJI_RE, (match) => {
    count += 1;
    return count <= max ? match : "";
  });
}

// Collapse runs of 3+ identical consecutive letters down to 2.
// e.g. "Sammmm" → "Samm", "Aaaron" → "Aaron"
function collapseTripleLetters(str) {
  return str.replace(/(.)\1{2,}/g, "$1$1");
}

// Combined name sanitiser: caps emojis + collapses triple letters
function sanitizeName(str) {
  return collapseTripleLetters(capEmojis(str));
}

const DEFAULT_POST_SUBMIT_SECONDS = 15;

// ---------------------------------------------------------------------
// Shared socket instance – same host as backend
// ---------------------------------------------------------------------
const socket = io(API_BASE_URL, {
  withCredentials: true,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

// Local session persistence is now in utils/localStorage.js

// Objective answer-key helpers are now in utils/answerKeyHelpers.js

// Theme helpers are now in utils/themeHelpers.js

// ---------------------------------------------------------------------
// Error boundary to prevent a blank-white-screen if a task component throws
// ---------------------------------------------------------------------
class TaskErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error) {
    if (this.props.onError) this.props.onError(error);
    // Also log for DevTools
    console.error("Task render error:", error);
  }
  render() {
    if (this.state.hasError) {
      const msg =
        (this.state.error && (this.state.error.message || String(this.state.error))) ||
        "Unknown error";
      return (
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>⚠ Task crashed</div>
          <div style={{ marginTop: 8, opacity: 0.85 }}>{msg}</div>
          {this.props.fallback || null}
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------

function StudentApp() {
  // Theme selector (must be inside component)
  const [uiTheme, setUiTheme] = useState("eager"); // "eager" | "bold" | "dyno"
  const themeShell = getThemeShell(uiTheme);
  const themeMode = getThemeMode(uiTheme);

  // Socket connection hook
  const { connected, setConnected, statusMessage, setStatusMessage } = useSocketConnection(socket);

  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]); // Update via socket.on('leaderboard-update', setLeaderboard)
  const [tasksetComplete, setTasksetComplete] = useState(false);
  const [postPhase, setPostPhase] = useState("tasks"); // "tasks" | "feedback" | "trophy"
  const [taskRenderError, setTaskRenderError] = useState(null);
  const [bumped, setBumped] = useState(null); // { reason } if team was bumped by presenter

  // Mystery Box mode state
  const [mysteryBoxGrid, setMysteryBoxGrid] = useState(null);
  const [challengeBeacon, setChallengeBeacon] = useState(null);
  const [milestoneCard, setMilestoneCard] = useState(null);
  const [isMysteryMode, setIsMysteryMode] = useState(false);
  const [scanFirstPopup, setScanFirstPopup] = useState(false);

  const [roomCode, setRoomCode] = useState(() => lsGet(LS_KEYS.roomCode) || "");
  const [teamName, setTeamName] = useState(() => lsGet(LS_KEYS.teamName) || "");
  // Members: array of { name, email } objects. Email is optional per member.
  const [members, setMembers] = useState(() => {
    try {
      const raw = lsGet(LS_KEYS.members);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) {
        // Migrate from old string[] format if needed
        if (typeof parsed[0] === "string") {
          // Old format: ["Alice", "Bob", ""]
          const oldEmails = (() => {
            try {
              const e = lsGet(LS_KEYS.emails);
              return e ? JSON.parse(e) : [];
            } catch { return []; }
          })();
          return parsed.map((name, i) => ({
            name: name || "",
            email: (Array.isArray(oldEmails) ? oldEmails[i] : "") || "",
          }));
        }
        // New format: [{name, email}, ...]
        return parsed;
      }
      return [{ name: "", email: "" }, { name: "", email: "" }, { name: "", email: "" }];
    } catch {
      return [{ name: "", email: "" }, { name: "", email: "" }, { name: "", email: "" }];
    }
  });
  // Derive flat name strings from members (backward compat for components expecting string[])
  const memberNames = members.map((m) => (typeof m === "string" ? m : m?.name || ""));
  // Derive flat emails array from members (backward compat for components expecting emails[])
  const emails = members.map((m) => (typeof m === "string" ? "" : m?.email || "").trim()).filter(Boolean);
  const setEmails = (updated) => {
    // updated is a string[] of emails — merge back into members
    setMembers((prev) =>
      prev.map((m, i) => ({
        ...(typeof m === "string" ? { name: m } : m),
        email: (Array.isArray(updated) ? updated[i] : "") || "",
      }))
    );
  };

  const [roomIsActive, setRoomIsActive] = useState(false);
  const [wantStreak, setWantStreak] = useState(false);
  const [roomState, setRoomState] = useState(null);

  // Collaboration
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [showPartnerReply, setShowPartnerReply] = useState(false);

  // Persistent identifiers
  const [teamId, setTeamId] = useState(null); // TeamSession _id from backend
  const [teamSessionId, setTeamSessionId] = useState(null);
  const userDroppedRoomRef = useRef(false);
  const resumeAttemptedRef = useRef(false);
 
  const lastStationIdRef = useRef(null);
  const lastScanKeyRef = useRef({ key: null, atMs: 0 });
  const stationScanInFlightRef = useRef(false);

  const [warmupDone, setWarmupDone] = useState(false);
  const [warmupStep, setWarmupStep] = useState("mood"); 

  // Station + scanner state
  const [assignedStationId, setAssignedStationId] = useState(null);
  const [assignedColor, setAssignedColor] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [displayAssignedColor, setDisplayAssignedColor] = useState(null);
  const [displayAssignedStationId, setDisplayAssignedStationId] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [waitingForLaunch, setWaitingForLaunch] = useState(false);
  const tasksStartedRef = useRef(false);
  const [tasksStarted, setTasksStarted] = useState(false);

  // refs that mirror state
  const assignedColorRef = useRef(null);
  useEffect(() => {
    assignedColorRef.current = assignedColor;
  }, [assignedColor]);

  const assignedStationIdRef = useRef(null);
  useEffect(() => {
    assignedStationIdRef.current = assignedStationId;
  }, [assignedStationId]);

  // Task + timer state
  const [currentTask, setCurrentTask] = useState(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(null);
  const [tasksetTotalTasks, setTasksetTotalTasks] = useState(null);
  // Team-local progress: how many tasks THIS team has been assigned (1-based display).
  // Unlike currentTaskIndex (global position in the taskset array), this always starts
  // at 1 for a team's first task — even if they joined late and skipped earlier tasks.
  const [teamTaskNumber, setTeamTaskNumber] = useState(0);
  const teamTaskNumberRef = useRef(0);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [currentAnswerDraft, setCurrentAnswerDraft] = useState("");
  const currentTaskRef = useRef(null);
  const lastSubmissionRef = useRef(null); // used for richer feedback (e.g., MadDash times)
  const pmcRescanTimerRef = useRef(null);
    useEffect(() => { currentTaskRef.current = currentTask; }, [currentTask]);
  const taskLockedRef = useRef(false);
  // Holds a task:assigned payload that arrived while the review overlay was showing.
  // Applied by endReviewAndReturnToScan once the lock is released.
  const pendingTaskAssignedRef = useRef(null);
  const postSubmitSecondsLeftRef = useRef(null);
  const taskStartedAtRef = useRef(null); // timestamp when current task was assigned (for speed bonus)
  const tasksCompletedCountRef = useRef(0); // increments each submission — used for reader rotation
  const lastReaderRef = useRef(""); // tracks previous reader to avoid repeats
  
  const postPhaseRef = useRef(postPhase);
    useEffect(() => { postPhaseRef.current = postPhase; }, [postPhase]);

  const isMysteryModeRef = useRef(isMysteryMode);
    useEffect(() => { isMysteryModeRef.current = isMysteryMode; }, [isMysteryMode]);

  // Noise + treats
  const [noiseState, setNoiseState] = useState({
    enabled: false,
    threshold: 0,
    level: 0,
    brightness: 1,
  });

  // NoiseSensor UI effects (client-side only)
  const [noiseOver, setNoiseOver] = useState(false);
  const [noisePulse, setNoisePulse] = useState(false);
  const noiseWarnRef = useRef({ prevOver: false, lastMs: 0 });

  const [treatMessage, setTreatMessage] = useState(null);

  // 🔢 Scoring: running total + last-task result + toast
  const [scoreTotal, setScoreTotal] = useState(0);
  const [lastTaskResult, setLastTaskResult] = useState(null);
  const [pointToast, setPointToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  // Correct-answer reveal for SHORT_ANSWER tasks
  const [shortAnswerReveal, setShortAnswerReveal] = useState(null);

  // How long to keep task visible after submit for review
  const [reviewPauseSeconds, setReviewPauseSeconds] = useState(15);
  const [postSubmitSecondsLeft, setPostSubmitSecondsLeft] = useState(null);
  const [taskLocked, setTaskLocked] = useState(false);
  const [reviewState, setReviewState] = useState(null);

  // Teacher-defined location (e.g. "Classroom", "Hallway") + stable ref
  const [roomLocation, setRoomLocation] = useState(DEFAULT_LOCATION);
  const roomLocationFromStateRef = useRef(DEFAULT_LOCATION);

  // Audio effects hook
  const {
    tryPlayAlertSound,
    tryPlayTreatSound,
    tryPlayEchoSound,
    tryPlayCorrectSound,
    tryPlayWrongSound,
    tryPlayNarrationSound,
    tryPlayScriptPlaySound,
    tryPlayReadingSound,
    tryPlayRolePlaySound,
    tryPlayFakeOutSound,
    tryPlayWordWeaverSound,
    tryPlayDebateSound,
    tryPlayPhotoSound,
    tryPlaySketchSound,
    tryPlayVennSound,
    tryPlayHuntSound,
    tryPlayYaySound,
    tryPlayTaskArrivalSound,
    tryPlayTimerWarningSound,
    tryPlaySessionEndSound,
  } = useSoundEffects();

  const [audioContext, setAudioContext] = useState(null);
  const requestedRoomStateRef = useRef(false);

  // EchoChain micro-theme pulse (purely visual)
  const [echoPulse, setEchoPulse] = useState(false);
  const [narrationSpark, setNarrationSpark] = useState(false);
  const [scriptSpotlight, setScriptSpotlight] = useState(false);
  const [rolePlayGlow, setRolePlayGlow] = useState(false);
  const [wordWeaverGlow, setWordWeaverGlow] = useState(false);
  const [fakeOutFlash, setFakeOutFlash] = useState(false);

  const [photoFlash, setPhotoFlash] = useState(false);
  const [sketchSpark, setSketchSpark] = useState(false);
  const [vennGlow, setVennGlow] = useState(false);
  const [readingGlow, setReadingGlow] = useState(false);
  const [huntPulse, setHuntPulse] = useState(false);
  const [debateGlow, setDebateGlow] = useState(false);

  // Timer refs
  const countdownTimerRef = useRef(null);
  const postSubmitTimerRef = useRef(null);

  // ---- Debug mode (enable via ?debug=1 or localStorage flag) ----
  const debugMode = (() => {
    try {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("debug") === "1") return true;
      if (localStorage.getItem("curriculate.debug") === "1") return true;
    } catch {}
    return false;
  })();

  const testMode = (() => {
    try {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("testMode") === "1") return true;
      if (localStorage.getItem("curriculate.testMode") === "1") return true;
    } catch {}
    return false;
  })();

  const [testTaskInput, setTestTaskInput] = useState("");
  const [testLocalOnly, setTestLocalOnly] = useState(true);
  const [testBypassScan, setTestBypassScan] = useState(true);
  const [activeTestTaskIndex, setActiveTestTaskIndex] = useState(null);

  const totalTaskCount =
    Number.isFinite(tasksetTotalTasks) && tasksetTotalTasks > 0
      ? tasksetTotalTasks
      : null;

  const testTaskOptions =
    Number.isFinite(tasksetTotalTasks) && tasksetTotalTasks > 0
      ? Array.from({ length: tasksetTotalTasks }, (_, index) => ({
          index,
          label: `Task ${index + 1}`,
        }))
      : [];

  // ─────────────────────────────────────────────
  // Socket connect / disconnect + auto-resume
  // ─────────────────────────────────────────────

  useEffect(() => {
    console.log("🚀 Curriculate StudentApp mounted. Build:", BUILD_MARKER);
  }, []);

  // ─────────────────────────────────────────────
  // Auto-resume: after refresh/reconnect, re-join the same room + team
  // (unless the user explicitly chose "Join another room")
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    if (joined) return;
    if (userDroppedRoomRef.current) return;
    if (resumeAttemptedRef.current) return;

    const savedRoom = (lsGet(LS_KEYS.roomCode) || "").trim().toUpperCase();
    const savedTeamSessionId = (lsGet(LS_KEYS.teamSessionId) || "").trim();
    if (!savedRoom || !savedTeamSessionId) return;

    resumeAttemptedRef.current = true;
    setStatusMessage("Reconnecting to your room…");

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setStatusMessage("");
      socket.off("rooms:available", onRooms);
    };

    const wipeAndReturnToJoin = (msg) => {
      clearSavedJoin();
      setRoomCode("");
      setJoined(false);
      setTeamId(null);
      setTeamSessionId(null);
      setStatusMessage(msg || "That room is no longer available. Please join a new room.");
      finish();
    };

    const doResume = () => {
      socket.emit(
        "resume-team-session",
        { roomCode: savedRoom, teamSessionId: savedTeamSessionId },
        (resp) => {
          const ok = resp && (resp.success === true || resp.ok === true);
          if (!ok) return wipeAndReturnToJoin(resp?.error || "Could not resume your session.");

          setRoomCode(savedRoom);
          setTeamId(resp.teamId || savedTeamSessionId);
          setTeamSessionId(resp.teamId || savedTeamSessionId);
          setJoined(true);
          setStatusMessage("");

          // Restore team name and members from server (most accurate)
          if (resp.teamName) setTeamName(resp.teamName);
          if (Array.isArray(resp.members) && resp.members.length > 0) {
            setMembers(resp.members);
          } else {
            // Fallback to localStorage
            try {
              const savedMembers = JSON.parse(lsGet(LS_KEYS.members) || "[]");
              if (Array.isArray(savedMembers) && savedMembers.length > 0) setMembers(savedMembers);
            } catch {}
          }

          // Restore team name from localStorage if server didn't send it
          if (!resp.teamName) {
            const savedName = lsGet(LS_KEYS.teamName);
            if (savedName) setTeamName(savedName);
          }

          const stationId = resp.assignedStationId || resp.stationId || null;
          if (stationId) {
            const stationInfo = normalizeStationId(stationId);
            // Prefer server-provided color over hardcoded index mapping
            const resolvedColor = resp.assignedColor || stationInfo.color || null;
            setAssignedStationId(stationInfo.id);
            setAssignedColor(resolvedColor);
            setDisplayAssignedStationId(stationInfo.id);
            setDisplayAssignedColor(resolvedColor);
            lastStationIdRef.current = stationInfo.id;
          }

          const state = resp.roomState || null;
          const effectiveTeam = resp.teamId || savedTeamSessionId;
          if (state?.scores && typeof state.scores[effectiveTeam] === "number") {
            setScoreTotal(state.scores[effectiveTeam]);
          }

          // Restore locally-saved progress (score, station)
          const savedScore = Number(lsGet(LS_KEYS.scoreTotal));
          if (savedScore > 0 && !(state?.scores && typeof state.scores[effectiveTeam] === "number")) {
            setScoreTotal(savedScore);
          }
          const savedTotal = Number(lsGet(LS_KEYS.tasksetTotal));
          if (savedTotal > 0) setTasksetTotalTasks(savedTotal);

          // Skip warmup on resume if concrete evidence this student already did warmup:
          // server sent a current task, score > 0, or warmup flag saved in localStorage.
          // Note: state.isActive alone is NOT enough — the room may be active but this
          // student may be joining for the first time and still needs scan + mood check.
          const hasProgress =
            !!resp.currentTask?.task ||
            (typeof state?.scores?.[effectiveTeam] === "number" && state.scores[effectiveTeam] > 0) ||
            lsGet(LS_KEYS.warmupDone) === "1";

          if (hasProgress) {
            tasksStartedRef.current = true;
            setWarmupStep("done");
            setPostPhase("tasks");
            // In mystery mode the box grid handles dispatch — don't show "Waiting…"
            const joinIsMystery = state?.navigationMode === "mystery";
            if (!joinIsMystery) {
              setWaitingForLaunch(true);
            }
            setScannerActive(false); // will be re-enabled by task:assigned or scan
          }

          // If server sent current task info, pre-set progress so UI doesn't flash
          if (resp.currentTask?.task) {
            const ct = resp.currentTask;
            setCurrentTask(ct.task);
            setCurrentTaskIndex(typeof ct.taskIndex === "number" ? ct.taskIndex : null);
            setTasksetTotalTasks(typeof ct.totalTasks === "number" ? ct.totalTasks : null);
            // Team's first task on this join
            teamTaskNumberRef.current = 1;
            setTeamTaskNumber(1);
          } else {
            // Restore task index from localStorage as fallback
            const savedIdx = Number(lsGet(LS_KEYS.taskIndex));
            if (savedIdx >= 0) setCurrentTaskIndex(savedIdx);
          }

          finish();
        }
      );
    };

    const onRooms = (roomsList = []) => {
      const exists = Array.isArray(roomsList)
        ? roomsList.some((r) => String(r?.roomCode || "").trim().toUpperCase() === savedRoom)
        : false;

      if (!exists) {
        // not broadcast => clear and return to join (no extra click)
        wipeAndReturnToJoin("Room is no longer available. Join a new room.");
        return;
      }

      // broadcast exists => resume
      doResume();
    };

    socket.on("rooms:available", onRooms);

    // Timeout safety in case broadcast is slow/offline
    // Also attempt direct resume in parallel — don't wait for broadcast
    const directResumeTimer = setTimeout(() => {
      if (finished) return;
      doResume();
    }, 2000);

    const t = setTimeout(() => {
      if (finished) return;
      // If we can't confirm broadcast, don't trap the UI.
      // Wipe saved join so user can join cleanly.
      wipeAndReturnToJoin("Could not confirm room. Please join a new room.");
    }, 10000);

    return () => {
      clearTimeout(t);
      clearTimeout(directResumeTimer);
      socket.off("rooms:available", onRooms);
    };
  }, [connected, joined]);

  // ─────────────────────────────────────────────
  // Silent re-join on socket reconnect (no full page reload)
  // After a brief network blip, socket.io reconnects automatically.
  // We must re-emit resume-team-session so the server re-associates
  // this socket with the room + team. Without this, the server
  // doesn't know who we are and stops pushing tasks.
  // ─────────────────────────────────────────────
  const hasConnectedOnceRef = useRef(false);
  useEffect(() => {
    const handleConnect = () => {
      if (!hasConnectedOnceRef.current) {
        // First connect — the auto-resume useEffect above handles this.
        hasConnectedOnceRef.current = true;
        return;
      }

      // This is a RE-connect. Silently re-join.
      const savedRoom = (lsGet(LS_KEYS.roomCode) || "").trim().toUpperCase();
      const savedTeamSessionId = (lsGet(LS_KEYS.teamSessionId) || "").trim();
      if (!savedRoom || !savedTeamSessionId) return;

      console.log("[reconnect] Re-joining room", savedRoom, "team", savedTeamSessionId);
      socket.emit("resume-team-session", { roomCode: savedRoom, teamSessionId: savedTeamSessionId }, (resp) => {
        if (!resp || (!resp.success && !resp.ok)) {
          console.warn("[reconnect] resume-team-session failed:", resp?.error);
          return;
        }

        // Restore server-side state quietly
        if (resp.teamId) {
          setTeamId(resp.teamId);
          setTeamSessionId(resp.teamId);
        }
        if (resp.teamName) setTeamName(resp.teamName);
        if (Array.isArray(resp.members) && resp.members.length > 0) setMembers(resp.members);

        const stationId = resp.assignedStationId || resp.stationId || null;
        if (stationId) {
          const stationInfo = normalizeStationId(stationId);
          // Prefer server-provided color over hardcoded index mapping
          const resolvedColor = resp.assignedColor || stationInfo.color || null;
          setAssignedStationId(stationInfo.id);
          setAssignedColor(resolvedColor);
          setDisplayAssignedStationId(stationInfo.id);
          setDisplayAssignedColor(resolvedColor);
        }

        const state = resp.roomState || null;
        if (state?.scores && typeof state.scores[resp.teamId || savedTeamSessionId] === "number") {
          setScoreTotal(state.scores[resp.teamId || savedTeamSessionId]);
        }

        console.log("[reconnect] Successfully re-joined.");
      });
    };

    socket.on("connect", handleConnect);
    return () => socket.off("connect", handleConnect);
  }, []); // stable — no deps needed, reads from localStorage + refs

  // ─────────────────────────────────────────────
  // Server event listeners – room, tasks, noise, treats, scoring
  // ─────────────────────────────────────────────

  useEffect(() => {
    taskLockedRef.current = taskLocked;
  }, [taskLocked]);

  useEffect(() => {
    postSubmitSecondsLeftRef.current = postSubmitSecondsLeft;
  }, [postSubmitSecondsLeft]);

  // ─────────────────────────────────────────────
  // Persist progress to localStorage so refresh picks up mid-session
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof currentTaskIndex === "number" && currentTaskIndex >= 0) {
      lsSet(LS_KEYS.taskIndex, String(currentTaskIndex));
    }
  }, [currentTaskIndex]);

  useEffect(() => {
    if (typeof scoreTotal === "number") {
      lsSet(LS_KEYS.scoreTotal, String(scoreTotal));
    }
  }, [scoreTotal]);

  useEffect(() => {
    if (typeof tasksetTotalTasks === "number" && tasksetTotalTasks > 0) {
      lsSet(LS_KEYS.tasksetTotal, String(tasksetTotalTasks));
    }
  }, [tasksetTotalTasks]);

  useEffect(() => {
    if (assignedStationId) lsSet(LS_KEYS.stationId, assignedStationId);
    if (assignedColor) lsSet(LS_KEYS.stationColor, assignedColor);
  }, [assignedStationId, assignedColor]);

  useEffect(() => {
    if (!teamId) return;

    // Room / station state updates
    const handleRoomState = (state) => {
      if (!state || !teamId) return;
      const myTeam = state.teams?.[teamId];
      if (!myTeam) return;

      // 📸 Persist selfie URLs to localStorage for refresh survival
      if (myTeam.selfieUrl) lsSet(LS_KEYS.selfieUrl, myTeam.selfieUrl);
      if (myTeam.themedSelfieUrl) lsSet(LS_KEYS.themedSelfieUrl, myTeam.themedSelfieUrl);

      // 🔢 Update running total score from room-wide scores map
      if (state.scores && typeof state.scores[teamId] === "number") {
        setScoreTotal(state.scores[teamId]);
      }

      // 🏆 Build a simple leaderboard from room state (fallback if no leaderboard-update event)
      if (state.scores && state.teams) {
        const entries = Object.entries(state.scores)
          .filter(([, sc]) => typeof sc === "number")
          .map(([tid, sc]) => ({
            teamName:
              state.teams?.[tid]?.teamName ||
              state.teams?.[tid]?.name ||
              `Team-${String(tid).slice(-4)}`,
            score: sc,
            rankChange: 0,
          }))
          .sort((a, b) => b.score - a.score);
        setLeaderboard(entries);
      }

      // ✅ store full roomState (instead of setSelectedRooms which doesn't exist)
      setRoomState(state);

      // ── Mystery box mode detection ──
      // Set isMysteryMode as soon as we see navigationMode, even before isActive,
      // so mystery-mode guards (mustScan bypass, requestNext skip, waitingForLaunch
      // suppression) all engage immediately.
      if (state.navigationMode === "mystery") {
        setIsMysteryMode(true);
        // Request grid once the room is active and we don't have one yet.
        // Do NOT request if there's a current task — that means a box was just
        // opened and the grid was intentionally hidden. Re-requesting would wipe the task.
        if (state.isActive && !mysteryBoxGrid && !currentTaskRef.current) {
          socket.emit("mystery:requestGrid", {
            roomCode: roomCode.trim().toUpperCase(),
            teamId,
          });
        }
      }

      const newStationId = myTeam.currentStationId || myTeam.stationId;
      if (newStationId && newStationId !== lastStationIdRef.current) {
        lastStationIdRef.current = newStationId;
        const stationInfo = normalizeStationId(newStationId);
        // Prefer the server's authoritative color from the stations array
        // (the server may shuffle colors, so hardcoded index mapping can be wrong)
        const serverStation = Array.isArray(state.stations)
          ? state.stations.find((s) => s?.id === stationInfo.id)
          : null;
        const resolvedColor = serverStation?.color || stationInfo.color || null;
        setAssignedStationId(stationInfo.id);
        setAssignedColor(resolvedColor);
      }

      const loc =
        myTeam.locationSlug ||
        state.locationSlug ||
        roomLocationFromStateRef.current ||
        DEFAULT_LOCATION;
      setRoomLocation(loc);
      roomLocationFromStateRef.current = loc;

      setRoomIsActive(!!state.isActive);

      if (!currentTaskRef.current) {
        // Don't overwrite feedback/trophy phase — taskset is done, we're
        // showing the multi-player feedback form or the victory screen.
        const currentPhase = postPhaseRef.current;

        // Safety net: if the team's taskIndex >= total tasks, the session is
        // over — trigger session-complete flow instead of "waiting for launch".
        const myIdx = typeof myTeam.taskIndex === "number" ? myTeam.taskIndex : -1;
        const totalTasks = Array.isArray(state.taskset?.tasks) ? state.taskset.tasks.length
          : (typeof state.totalTasks === "number" ? state.totalTasks : -1);
        if (myIdx >= 0 && totalTasks > 0 && myIdx >= totalTasks &&
            currentPhase !== "feedback" && currentPhase !== "trophy") {
          console.log("[StudentApp] room:state — team past last task (%d/%d), triggering session:complete", myIdx, totalTasks);
          setCurrentTask(null);
          setCurrentTaskIndex(null);
          setWaitingForLaunch(false);
          setScannerActive(false);
          setReviewState(null);
          setPostSubmitSecondsLeft(null);
          if (postSubmitTimerRef.current) {
            clearInterval(postSubmitTimerRef.current);
            postSubmitTimerRef.current = null;
          }
          setPostPhase("feedback");
          tryPlaySessionEndSound();
        } else if (currentPhase !== "feedback" && currentPhase !== "trophy") {
          // In mystery mode, the box grid handles task dispatch — don't show
          // "Getting your first activity ready…" which would cover the grid.
          const isMystery = state.navigationMode === "mystery";
          if (!isMystery) {
            setWaitingForLaunch(true);
          }
          // Only jump to "tasks" phase if this student has already started
          // (i.e. completed warmup). Fresh joins must go through scan → mood
          // → treasure first, even when the room is already active.
          // The warmup-in-progress phases are "scan", "mood", "selfie", "treasure".
          const warmupInProgress =
            currentPhase === "scan" || currentPhase === "mood" ||
            currentPhase === "selfie" || currentPhase === "treasure";
          if ((tasksStartedRef.current || tasksStarted) && !warmupInProgress) {
            setPostPhase("tasks");
          }
        }
      }
      
      const noiseCfg = state.noiseConfig || {};
      setNoiseState((prev) => ({
        ...prev,
        enabled: !!noiseCfg.enabled,
        threshold: typeof noiseCfg.threshold === "number" ? noiseCfg.threshold : 0,
      }));
    };

    const handleTaskAssigned = (payload) => {
      if (!payload) return;

      // If we're in the middle of a post-submit review, queue this assignment
      // and apply it once the review ends instead of blowing away the overlay.
      if (taskLockedRef.current) {
        pendingTaskAssignedRef.current = payload;
        return;
      }

      const limit = payload.timeLimitSeconds || null;
      lastScanKeyRef.current = { key: null, atMs: 0 };
      setTimeLimitSeconds(limit);
      setSubmitting(false);

      console.log("[StudentApp] task:assigned", payload?.task || payload);

      if (limit && limit > 0) {
        const endTime = Date.now() + limit * 1000;
        setRemainingMs(endTime - Date.now());
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
        }
        countdownTimerRef.current = setInterval(() => {
          setRemainingMs((prev) => {
            if (!prev || prev <= 1000) {
              clearInterval(countdownTimerRef.current);
              return 0;
            }
            return prev - 1000;
          });
        }, 1000);
      } else {
        setRemainingMs(0);
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
      }

      tasksStartedRef.current = true;
      setWarmupStep("done");
      lsSet(LS_KEYS.warmupDone, "1");
      setPostPhase("tasks");
      setWaitingForLaunch(false);

      // In mystery mode, hide the grid while working on a task
      if (isMysteryMode) {
        setMysteryBoxGrid(null);
        setChallengeBeacon(null);
        // Update station assignment from the mystery box payload so the scan gate
        // knows which station the student must scan BEFORE room:state arrives.
        const mysteryStation = payload?.mysteryBox?.stationColor;
        if (mysteryStation) {
          const stationInfo = normalizeStationId(mysteryStation);
          if (stationInfo?.id) {
            setAssignedStationId(stationInfo.id);
            assignedStationIdRef.current = stationInfo.id;
          }
          if (stationInfo?.color) {
            setAssignedColor(stationInfo.color);
          }
          // Clear previous scan so they must re-scan for this new task's station
          setScannedStationId(null);
        }
      }

      const payloadIsTestMode = payload?.testMode === true;

      if (payloadIsTestMode && payload?.bypassScan) {
        setScannerActive(false);
        setScannedStationId(
          assignedStationId ||
          normalizeStationId(assignedStationIdRef.current)?.id ||
          null
        );
      }

      const assignedTask = payload.task || payload || null;
      const assignedType = String(assignedTask?.taskType || assignedTask?.type || "");

      if (payloadIsTestMode) {
        setActiveTestTaskIndex(
          typeof payload?.taskIndex === "number" ? payload.taskIndex : null
        );
      } else {
        setActiveTestTaskIndex(null);
      }
        
      const assignedIsPhysicalMC = assignedType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;
      const assignedIsMadDash =
        assignedType === TASK_TYPES.MAD_DASH ||
        assignedType === TASK_TYPES.MAD_DASH_SEQUENCE ||
        assignedType === "mad-dash" ||
        assignedType === "mad-dash-sequence";

      // -----------------------------------------------------------------
      // IMPORTANT: PhysicalMultipleChoiceTask must know the team's *current* station color
      // so it can exclude it from the 4 A/B/C/D option colors.
      //
      // The student app *does* know this (assignedStationId/assignedColor),
      // but the task payload from the server usually does NOT include it.
      // So we inject a stable `stationColor` (and stationId for debugging) into the task object.
      // -----------------------------------------------------------------
      let assignedTaskWithMeta = assignedTask;
      if (assignedTask && assignedIsPhysicalMC) {
        const inferredColor =
          assignedColorRef.current ||
          normalizeStationId(assignedStationIdRef.current)?.color ||
          null;

        assignedTaskWithMeta = {
          ...assignedTask,
          stationColor:
            assignedTask?.stationColor ||
            assignedTask?.config?.stationColor ||
            inferredColor,
          stationId:
            assignedTask?.stationId ||
            assignedStationIdRef.current ||
            null,
        };

        // ✅ PMC has already been unlocked by the entry scan.
        // From here on, scans should be treated as PMC answer scans,
        // not as "scan your assigned station to begin".
        setScannedStationId(
          assignedStationIdRef.current ||
          assignedStationId ||
          null
        );
        setScanStatus(null);
        setScanError(null);
      }

      // Physical MC needs the global scanner panel. MadDash uses the embedded task scanner.
      // Mystery mode: every task needs a station scan after the box tap to unlock.
      const assignedNeedsScanner =
        payloadIsTestMode && payload?.bypassScan
          ? false
          : (assignedIsPhysicalMC || assignedIsMadDash || (isMysteryMode && !!assignedColor));
      setScannerActive(assignedNeedsScanner);

      // Play task arrival sound for every new task
      tryPlayTaskArrivalSound();

      if (assignedIsMadDash) {
        // tryPlayAlertSound();
        setTreatMessage("🏁 Mad Dash — watch the sequence, then scan the colors IN ORDER as fast as you can!");
        window.setTimeout(() => setTreatMessage(null), 4200);
      }
      if (assignedIsPhysicalMC) {
        // tryPlayAlertSound();
        setTreatMessage("🚶‍♂️ Physical Multiple Choice — pick A/B/C/D, then scan the matching color station!");
        window.setTimeout(() => setTreatMessage(null), 4200);
      }

      // EchoChain: quick audio + subtle pulse so the team knows it's a "say-it-aloud" round.
      if (assignedType === TASK_TYPES.ECHO_CHAIN) {
        tryPlayEchoSound();
        setEchoPulse(true);
        window.setTimeout(() => setEchoPulse(false), 1200);
        setTreatMessage("🔁 Echo Chain — say it aloud, add one, and keep the chain going!");
        window.setTimeout(() => setTreatMessage(null), 3200);
      }

      if (
        assignedType === TASK_TYPES.NARRATION_SYNTHESIZE ||
        assignedType === "narration-synthesize"
      ) {
        tryPlayNarrationSound();
        setNarrationSpark(true);
        window.setTimeout(() => setNarrationSpark(false), 1200);
        setTreatMessage("🗣️ Teach-back time — explain it out loud, then tap Finished.");
      }

      // RolePlayDeck: subtle reveal cue + glow theme
      if (
        assignedType === TASK_TYPES.ROLE_PLAY_DECK || assignedType === "role-play-deck"
      ) {
        tryPlayRolePlaySound();
        setRolePlayGlow(true);
        window.setTimeout(() => setRolePlayGlow(false), 1200);
      }

      // FakeOut: listening + voting round (intra-team only)
      if (assignedType === TASK_TYPES.FAKE_OUT || assignedType === "fake-out") {
        tryPlayFakeOutSound();
        setFakeOutFlash(true);
        window.setTimeout(() => setFakeOutFlash(false), 1200);
        setTreatMessage(
          "🃏 Fake Out — one player reads aloud; everyone else LISTENS and votes!"
        );
        window.setTimeout(() => setTreatMessage(null), 3800);
      }

      // WordWeaver Duel: Scrabble-style, turn-based intra-team play
      if (
        assignedType === TASK_TYPES.WORD_WEAVER_DUEL ||
        assignedType === "word-weaver-duel" ||
        assignedType === "word-weaver" ||
        assignedType === "wordweaver"
      ) {
        tryPlayWordWeaverSound();
        setWordWeaverGlow(true);
        window.setTimeout(() => setWordWeaverGlow(false), 1300);
        setTreatMessage("🧩 Word Weaver Duel — take turns placing words on the grid for points!");
        window.setTimeout(() => setTreatMessage(null), 4200);
      }

      // VennSort: quick "sorting" cue
      if (assignedType === TASK_TYPES.VENNSORT || assignedType === "vennsort" || assignedType === "venn-sort") {
        tryPlayVennSound();
        setVennGlow(true);
        window.setTimeout(() => setVennGlow(false), 1200);
        setTreatMessage("⭕ Venn Sort — drag items into the best regions (overlaps count!)");
        window.setTimeout(() => setTreatMessage(null), 3600);
      }

      // ReadingComp: calm "page turn" cue
      if (
        assignedType === TASK_TYPES.READING_COMP ||
        assignedType === "reading-comp" ||
        assignedType === "readingcomprehension" ||
        assignedType === "reading-comprehension"
      ) {
        tryPlayReadingSound();
        setReadingGlow(true);
        window.setTimeout(() => setReadingGlow(false), 1400);
        setTreatMessage("📖 Reading Comprehension — read carefully, then write ONE strong sentence.");
        window.setTimeout(() => setTreatMessage(null), 4200);
      }

      // Speed Draw: pictionary cue
      if (assignedType === TASK_TYPES.SPEED_DRAW || assignedType === "speed-draw" || assignedType === "speeddraw") {
        tryPlaySketchSound();
        setSketchSpark(true);
        window.setTimeout(() => setSketchSpark(false), 1200);
        setTreatMessage("✏️ Speed Draw — one draws fast, teammates guess faster!");
        window.setTimeout(() => setTreatMessage(null), 3600);
      }

      // Photo / PhotoJournal: camera cue
      if (
        assignedType === TASK_TYPES.PHOTO ||
        assignedType === "photo" ||
        assignedType === TASK_TYPES.PHOTO_JOURNAL ||
        assignedType === "photo-journal" ||
        assignedType === "photo_journal"
      ) {
        tryPlayPhotoSound();
        setPhotoFlash(true);
        window.setTimeout(() => setPhotoFlash(false), 520);
      }

      // HideNSeek: hunt cue
      if (assignedType === TASK_TYPES.HIDENSEEK || assignedType === "hidenseek" || assignedType === "hide-n-seek") {
        tryPlayHuntSound();
        setHuntPulse(true);
        window.setTimeout(() => setHuntPulse(false), 1200);
        setTreatMessage("🔎 Hide & Seek — find it, snap proof, and explain why it matters.");
        window.setTimeout(() => setTreatMessage(null), 4200);
      }

      // AI Debate Judge: gavel cue + courtroom glow
      if (
        assignedType === TASK_TYPES.AI_DEBATE_JUDGE ||
        assignedType === "ai-debate-judge" ||
        assignedType === "ai_debate_judge" ||
        assignedType === "aidebatejudge"
      ) {
        tryPlayDebateSound();
        setDebateGlow(true);
        window.setTimeout(() => setDebateGlow(false), 1400);
        setTreatMessage("🧑‍⚖️ AI Debate Judge — choose your side & role, then tap 1‑2‑3 GO to record.");
        window.setTimeout(() => setTreatMessage(null), 5200);
      }

      setCurrentTask(assignedTaskWithMeta);
      taskStartedAtRef.current = Date.now();
      setPostPhase("tasks"); // Clear mood

      // Increment team-local task counter (1-based: first task = 1)
      const nextTeamNum = teamTaskNumberRef.current + 1;
      teamTaskNumberRef.current = nextTeamNum;
      setTeamTaskNumber(nextTeamNum);

      const idx =
        typeof payload.taskIndex === "number"
          ? payload.taskIndex
          : typeof payload.index === "number"
          ? payload.index
          : null;
      setCurrentTaskIndex(idx);
      const total =
        typeof payload.totalTasks === "number"
          ? payload.totalTasks
          : typeof payload.total === "number"
          ? payload.total
          : null;
      setTasksetTotalTasks(total);

      setCurrentAnswerDraft("");
      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);
      setReviewState(null);
      setLastTaskResult(null);
      setPointToast(null);
      setShortAnswerReveal(null);
      setTasksetComplete(false);
      setTasksStarted(true);
      setWarmupStep("done");
      lsSet(LS_KEYS.warmupDone, "1");
      setPostPhase("tasks");
      setTaskRenderError(null);

    };

    // AI scoring + feedback
    const handleTaskScored = (payload) => {
      if (!payload || typeof payload !== "object") return;

      const {
        teamId: scoredTeamId,
        taskId,
        taskIndex,
        scoreDelta,
        totalScore,
        maxPoints,
        aiFeedback,
        correctAnswer,
        shortAnswerReveal: reveal,
        method,
      } = payload;

      if (reveal) {
        setShortAnswerReveal(reveal || null);
      }

      if (!teamId || scoredTeamId !== teamId) return;

      if (typeof totalScore === "number") {
        setScoreTotal(totalScore);
      } else if (typeof scoreDelta === "number") {
        setScoreTotal((prev) => prev + scoreDelta);
      }
      // ✅ If the CURRENT task is physical, do NOT show the lock/overlay countdown.
      // Some physical tasks can still emit task:scored (AI/teacher scoring), but we want
      // the UI to immediately return to scan.
      const liveTask = currentTaskRef.current;
      const liveType = liveTask?.taskType || liveTask?.type;
      const isPhysicalLive =
        !!(liveTask?.isPhysical ||
          liveTask?.config?.isPhysical ||
          liveTask?.movement ||
          liveTask?.config?.movement ||
          liveType === TASK_TYPES.BODY_BREAK ||
          liveType === TASK_TYPES.MAD_DASH_SEQUENCE ||
          liveType === TASK_TYPES.MAD_DASH ||
          liveType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE);

      // ------------------------------------------------------------
      // Rich student feedback (toast + SFX + confetti)
      // ------------------------------------------------------------
      const delta = typeof scoreDelta === "number" ? scoreDelta : 0;
      const isMadDashLive =
        liveType === TASK_TYPES.MAD_DASH || liveType === TASK_TYPES.MAD_DASH_SEQUENCE;

      // Default toast
      let toastMsg = null;
      let toastPositive = delta >= 0;

      if (isMadDashLive) {
        const submission = lastSubmissionRef.current;
        const ans = submission?.answer && typeof submission.answer === "object" ? submission.answer : null;
        const bestTimeMs = Number(ans?.bestTimeMs ?? ans?.timeMs ?? NaN);
        const fmtMs = (ms) => {
          if (!Number.isFinite(ms) || ms <= 0) return null;
          return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + "s";
        };
        const bestTime = fmtMs(bestTimeMs);

        const basePoints =
          Number(liveTask?.points ?? liveTask?.config?.points ?? 10) || 10;
        const bonusPoints =
          Number(liveTask?.config?.bestTimeBonusPoints ?? 5) || 5;
        const gotBonus = delta >= basePoints + bonusPoints;

        toastMsg = `Mad Dash complete${bestTime ? `! Best time: ${bestTime}.` : "!"} +${delta}`;
        if (gotBonus) toastMsg += ` (includes +${bonusPoints} fastest-time bonus)`;
        toastPositive = delta > 0;

        // Celebrate bonus / big wins
        if (gotBonus || delta >= (typeof maxPoints === "number" ? maxPoints : basePoints)) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 1400);
        }
      } else if (typeof scoreDelta === "number" && delta > 0) {
        toastMsg = `+${Math.round(delta)} pts`;
        if (aiFeedback) toastMsg += ` — ${aiFeedback}`;
        toastPositive = true;
        // Big score celebration
        if (delta >= 80) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 2000);
        }
      } else if (aiFeedback) {
        toastMsg = aiFeedback;
        toastPositive = delta > 0;
      } else if (typeof scoreDelta === "number") {
        toastMsg = delta >= 0 ? `+${delta}` : `${delta}`;
        toastPositive = delta > 0;
      }

      if (toastMsg) {
        setPointToast({ message: toastMsg, positive: toastPositive });
      }

      // SFX: treat MadDash completion as "correct" when points are gained.
      if (delta > 0) tryPlayCorrectSound();
      else if (typeof scoreDelta === "number" && scoreDelta < 0) tryPlayWrongSound();
      setLastTaskResult({
          scoreDelta: typeof scoreDelta === "number" ? scoreDelta : null,
          maxPoints: typeof maxPoints === "number" ? maxPoints : null,
          aiFeedback: aiFeedback || null,
          taskId: taskId || null,
          taskIndex: typeof taskIndex === "number" && taskIndex >= 0 ? taskIndex : null,
          method: method || null,
          correctAnswer: correctAnswer ?? null,
        });

      setTimeout(() => {
        setPointToast(null);
      }, 2500);
    };

    const handleNoiseUpdate = (payload) => {
      if (!payload) return;
      setNoiseState((prev) => ({
        ...prev,
        enabled: typeof payload.enabled === "boolean" ? payload.enabled : prev.enabled,
        threshold: typeof payload.threshold === "number" ? payload.threshold : prev.threshold,
        level: typeof payload.level === "number" ? payload.level : prev.level,
        brightness: typeof payload.brightness === "number" ? payload.brightness : prev.brightness,
      }));
    };

    const handleTreat = (payload) => {
      if (!payload) return;
      if (payload.type === "point-bonus") {
        setTreatMessage(payload.message || "Surprise point bonus for your team!");
        tryPlayTreatSound();
        setTimeout(() => setTreatMessage(null), 4000);
      } else if (payload.type === "fun-message") {
        setTreatMessage(payload.message || "Random treat for being awesome!");
        tryPlayTreatSound();
        setTimeout(() => setTreatMessage(null), 4000);
      }
    };

    const handleCollabPartner = (payload) => {
      if (!payload || payload.teamId !== teamId) return;
      setPartnerAnswer(payload.answer ?? null);
    };

    const handleBehaviorDing = (payload) => {
      if (!payload || payload.teamId !== teamId) return;
      const pts = payload.delta || 0;
      const reason = payload.reason || "";
      const positive = pts > 0;

      // Update score immediately
      if (typeof pts === "number") {
        setScoreTotal((prev) => prev + pts);
      }

      // Show a prominent toast
      const msg = positive
        ? `+${Math.round(pts)} ${reason}`
        : `${Math.round(pts)} ${reason}`;
      setPointToast({ message: msg, positive });
      if (positive) tryPlayCorrectSound();
      else tryPlayWrongSound();

      setTimeout(() => setPointToast(null), 3500);
    };

    const handleCollabReply = (payload) => {
      if (!payload || payload.teamId !== teamId) return;
      setShowPartnerReply(true);
      setTimeout(() => setShowPartnerReply(false), 4000);
    };

    const handleNewTask = (payload) =>
      handleTaskAssigned({
        task: payload?.task || payload,
        index: payload?.taskIndex ?? payload?.index ?? 0,
        taskIndex: payload?.taskIndex ?? payload?.index ?? 0,
        totalTasks: payload?.totalTasks,
        timeLimitSeconds: payload?.timeLimitSeconds,
      });

    // Handle pacing hold (waiting for other teams to catch up)
    const handlePacingHold = (payload) => {
      console.log("[StudentApp] Pacing hold:", payload);
      setReviewState((prev) => ({
        ...prev,
        pacingHold: true,
        pacingMessage: payload?.message || "Waiting for other teams to catch up...",
      }));
    };

    // Handle pacing release (other teams caught up, can progress)
    const handlePacingRelease = (payload) => {
      console.log("[StudentApp] Pacing released:", payload);
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
      }
      setReviewState(null);
      setPostSubmitSecondsLeft(null);
      endReviewAndReturnToScan();
    };

    // Handle server telling us all tasks are done (e.g. after page reload
    // when team has already completed every task in the taskset).
    const handleSessionComplete = () => {
      console.log("[StudentApp] session:complete — all tasks done");
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setWaitingForLaunch(false);
      setScannerActive(false);
      // Clear any post-submit review state so feedback form can render
      setReviewState(null);
      setPostSubmitSecondsLeft(null);
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
        postSubmitTimerRef.current = null;
      }
      setPostPhase("feedback");
      tryPlaySessionEndSound();
      // Don't set tasksetComplete yet — feedback form should show first
    };

    socket.on("room:state", handleRoomState);
    socket.on("task:assigned", handleTaskAssigned);
    socket.on("task:launch", handleTaskAssigned);
    socket.on("task:scored", handleTaskScored);
    socket.on("noise:update", handleNoiseUpdate);
    socket.on("treat:event", handleTreat);
    socket.on("collab:partner-answer", handleCollabPartner);
    socket.on("collab:reply", handleCollabReply);
    socket.on("behavior:ding", handleBehaviorDing);
    socket.on("team:pacing-hold", handlePacingHold);
    socket.on("team:pacing-released", handlePacingRelease);
    socket.on("session:complete", handleSessionComplete);

    const handleBumped = (payload) => {
      if (payload?.teamId && payload.teamId !== teamId) return;
      setBumped({ reason: payload?.reason || "Removed by presenter" });
      setJoined(false);
    };
    socket.on("team:bumped", handleBumped);

    // ── Mystery Box mode listeners ──
    const handleMysteryBoxGrid = (grid) => {
      if (!grid) return;
      console.log("[StudentApp] mystery:boxGrid received", grid);
      setMysteryBoxGrid(grid);
      setIsMysteryMode(true);
      // Only clear currentTask if there is NO active task — don't wipe a task
      // that was just assigned via a box tap (race with room:state re-requesting grid)
      if (!currentTaskRef.current) {
        setCurrentTask(null);
      }
      setWaitingForLaunch(false);
      // If student is still in warmup pipeline, DON'T yank them to tasks phase.
      // The grid is stored; warmup completion handlers will route to grid when ready.
      const phase = postPhaseRef.current;
      const warmupInProgress =
        phase === "scan" || phase === "mood" ||
        phase === "selfie" || phase === "treasure";
      if (!warmupInProgress) {
        tasksStartedRef.current = true;
        setWarmupStep("done");
        lsSet(LS_KEYS.warmupDone, "1");
        setPostPhase("tasks");
      }
    };
    const handleChallengeBeacon = (beacon) => {
      console.log("[StudentApp] mystery:challengeBeacon", beacon);
      setChallengeBeacon(beacon);
      // Auto-clear after expiry
      if (beacon?.expiresAt) {
        const remaining = beacon.expiresAt - Date.now();
        if (remaining > 0) {
          setTimeout(() => setChallengeBeacon((prev) => prev?.challengeId === beacon.challengeId ? null : prev), remaining);
        }
      }
    };
    const handleChallengeExpired = (payload) => {
      console.log("[StudentApp] mystery:challengeExpired", payload);
      // Challenger can proceed solo now — no special UI needed, they already have the task
    };
    const handleChallengeAccepted = (payload) => {
      console.log("[StudentApp] mystery:challengeAccepted", payload);
      // Show brief notification to challenger
    };
    const handleChallengeQueued = (payload) => {
      console.log("[StudentApp] mystery:challengeQueued", payload);
      // Acceptor sees "queued" info — grid will show it
    };
    const handleMysteryTimeUp = () => {
      console.log("[StudentApp] mystery:timeUp");
      setTasksetComplete(true);
    };
    const handleMilestoneCard = (card) => {
      console.log("[StudentApp] mystery:milestoneCard", card);
      setMilestoneCard(card);
    };

    // Auto-start triggered — room just became active. Set roomIsActive
    // as a safety net (room:state broadcast also sets it, but this is
    // a direct, unmissable signal).
    const handleAutoStartTriggered = () => {
      console.log("[StudentApp] autoStart:triggered — room is now active");
      setRoomIsActive(true);
    };

    socket.on("mystery:boxGrid", handleMysteryBoxGrid);
    socket.on("mystery:challengeBeacon", handleChallengeBeacon);
    socket.on("mystery:challengeExpired", handleChallengeExpired);
    socket.on("mystery:challengeAccepted", handleChallengeAccepted);
    socket.on("mystery:challengeQueued", handleChallengeQueued);
    socket.on("mystery:timeUp", handleMysteryTimeUp);
    socket.on("mystery:milestoneCard", handleMilestoneCard);
    socket.on("autoStart:triggered", handleAutoStartTriggered);

    socket.emit("room:request-state", {
      roomCode: roomCode.trim().toUpperCase(),
      teamId,
    });

    return () => {
      socket.off("room:state", handleRoomState);
      socket.off("task:assigned", handleTaskAssigned);
      socket.off("task:launch", handleTaskAssigned);
      socket.off("task:scored", handleTaskScored);
      socket.off("noise:update", handleNoiseUpdate);
      socket.off("treat:event", handleTreat);
      socket.off("collab:partner-answer", handleCollabPartner);
      socket.off("collab:reply", handleCollabReply);
      socket.off("behavior:ding", handleBehaviorDing);
      socket.off("team:pacing-hold", handlePacingHold);
      socket.off("team:pacing-released", handlePacingRelease);
      socket.off("session:complete", handleSessionComplete);
      socket.off("team:bumped", handleBumped);
      socket.off("mystery:boxGrid", handleMysteryBoxGrid);
      socket.off("mystery:challengeBeacon", handleChallengeBeacon);
      socket.off("mystery:challengeExpired", handleChallengeExpired);
      socket.off("mystery:challengeAccepted", handleChallengeAccepted);
      socket.off("mystery:challengeQueued", handleChallengeQueued);
      socket.off("mystery:timeUp", handleMysteryTimeUp);
      socket.off("mystery:milestoneCard", handleMilestoneCard);
      socket.off("autoStart:triggered", handleAutoStartTriggered);
    };
  }, [teamId, roomCode]
  );

  // ----------------------------------------------------
  // NoiseSensor special effects:
  // - when noise crosses the threshold, pulse the noise bar and (optionally) play a soft beep
  // ----------------------------------------------------
  useEffect(() => {
    if (!noiseState?.enabled) {
      setNoiseOver(false);
      noiseWarnRef.current.prevOver = false;
      return;
    }

    // Both threshold and level are on the same 0–100 scale from the server
    const thr = Number(noiseState.threshold || 0);
    const lvl = Number(noiseState.level || 0);

    const over = thr > 0 ? lvl >= thr : false;
    setNoiseOver(over);

    // edge-trigger: only when crossing into "over"
    if (over && !noiseWarnRef.current.prevOver) {
      setNoisePulse(true);
      window.setTimeout(() => setNoisePulse(false), 650);

      // gentle warning beep (debounced)
      const now = Date.now();
      if (now - (noiseWarnRef.current.lastMs || 0) > 2500) {
        noiseWarnRef.current.lastMs = now;

        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine";
            o.frequency.value = 880;
            g.gain.value = 0.0001;
            o.connect(g);
            g.connect(ctx.destination);
            o.start();
            // quick envelope (very quiet)
            g.gain.exponentialRampToValueAtTime(0.02, ctx.currentTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
            o.stop(ctx.currentTime + 0.2);
            window.setTimeout(() => {
              try { ctx.close(); } catch {}
            }, 250);
          }
        } catch {
          // ignore audio errors (autoplay policies etc.)
        }
      }
    }

    noiseWarnRef.current.prevOver = over;
  }, [noiseState.enabled, noiseState.threshold, noiseState.level]);


  // -------------------------------------------------------------------
  // Auto-open scanner when a scan is required
  // -------------------------------------------------------------------
  const enforceLocation = !!roomState?.taskset?.enforceLocation;
  const selectedRooms = roomState?.selectedRooms || [];

  const taskHardLocksStation =
    !!enforceLocation ||
    !!currentTask?.lockToStation ||
    !!currentTask?.config?.lockToStation ||
    !!currentTask?.fixedStationId ||
    !!currentTask?.config?.fixedStationId ||
    !!currentTask?.lockToStationId ||
    !!currentTask?.config?.lockToStationId;
    
    const testModeBypassesScan =
    testMode && activeTestTaskIndex != null && testBypassScan;

  const mustScan =
    testModeBypassesScan
      ? false
      : taskLocked
      ? false
      : assignedStationId
        ? (scannedStationId !== assignedStationId)
        : (!!assignedColor && !scannedStationId);

  const hardMustScan = taskHardLocksStation && mustScan;
    
  const lastRequestNextAtRef = useRef(0);

  useEffect(() => {
    if (!joined) return;

    const taskWantsScan = (() => {
      try { return !!window.__curriculateTaskWantsScan; } catch { return false; }
    })();

    // Compute taskNeedsGlobalScanner locally (defined later in component, can't use as dep)
    const liveType = currentTask?.taskType || currentTask?.type;
    const needsGlobalScanner =
      liveType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE ||
      liveType === TASK_TYPES.MAD_DASH ||
      liveType === TASK_TYPES.MAD_DASH_SEQUENCE;

    // Compute desired scanner state directly — no reading scannerActive here.
    const shouldBeActive = (() => {
      if (taskLocked && !taskWantsScan) return false;
      // In mystery mode, suppress the scanner when there's no active task
      // AND the student has already scanned their station (they're at the grid
      // and should pick a mystery box first, THEN scan for the next task).
      // But during warmup (initial scan), the scanner MUST be allowed.
      const phase = postPhaseRef.current;
      const inWarmup = phase === "scan" || phase === "mood" || phase === "selfie" || phase === "treasure";
      if (isMysteryMode && !currentTask && !inWarmup) return false;
      if (mustScan) return true;
      if (needsGlobalScanner) return true;
      if (taskWantsScan) return true;
      return false;
    })();

    setScannerActive(shouldBeActive);

    const inferredColor =
      assignedColorRef.current || normalizeStationId(assignedStationIdRef.current)?.color;

    if (!inferredColor && teamId && roomCode && !requestedRoomStateRef.current) {
      requestedRoomStateRef.current = true;
      socket.emit("room:request-state", {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
      });
    }

    if (inferredColor) {
      requestedRoomStateRef.current = false;
    }
  }, [
    joined,
    mustScan,
    currentTask,
    waitingForLaunch,
    assignedColor,
    assignedStationId,
    teamId,
    roomCode,
    taskLocked,
    postSubmitSecondsLeft,
    isMysteryMode,
  ]);

  useEffect(() => {
    if (currentTask && postPhase !== "tasks") {
      setPostPhase("tasks");
    }
  }, [currentTask, postPhase]);

  // Mystery mode: when the room activates while student is in treasure/warmup,
  // bump them straight to selfie (if needed) or the mystery box grid.
  // This handles "arm → launch on first join" when teams are already connected.
  useEffect(() => {
    if (!isMysteryMode || !roomIsActive || !joined) return;
    const phase = postPhaseRef.current;
    if (phase !== "treasure") return;

    const hasSelfie = !!(lsGet(LS_KEYS.selfieUrl));
    if (hasSelfie) {
      setWarmupStep("done");
      lsSet(LS_KEYS.warmupDone, "1");
      tasksStartedRef.current = true;
      setPostPhase("tasks");
      socket.emit("mystery:requestGrid", {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
      });
    } else {
      setWarmupStep("selfie");
      setPostPhase("selfie");
    }
  }, [isMysteryMode, roomIsActive, joined]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      setReviewState(null);
      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);
      setReviewState(null);
      setShortAnswerReveal(null);
      if (postSubmitTimerRef.current) {
        clearInterval(postSubmitTimerRef.current);
      }
    };
  }, []);

  // Audio setup and handlers are now in hooks/useSoundEffects.js

  useEffect(() => {
    window.__curriculatePlayWrongSound = () => {
      tryPlayWrongSound();
    };

    window.__curriculatePlayCorrectSound = () => {
      tryPlayCorrectSound();
    };

    return () => {
      delete window.__curriculatePlayWrongSound;
      delete window.__curriculatePlayCorrectSound;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      lastScanKeyRef.current = { key: null, atMs: 0 };
    };

    window.addEventListener("curriculate:resetScanDedupe", handler);
    return () => {
      window.removeEventListener("curriculate:resetScanDedupe", handler);
    };
  }, []);

  // All tryPlay* functions are now in hooks/useSoundEffects.js

  function requestTestTaskByIndex(index) {
    const safeIndex = Number(index);
    if (!joined || !roomCode || !teamId) {
      setStatusMessage("Join a room first.");
      return;
    }
    if (!Number.isInteger(safeIndex) || safeIndex < 0) {
      setStatusMessage("Enter a valid task number.");
      return;
    }

    setStatusMessage("Loading test task…");

    socket.emit(
      "task:testRequestByIndex",
      {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        taskIndex: safeIndex,
        bypassScan: testBypassScan,
        localOnly: testLocalOnly,
      },
      (resp) => {
        if (!resp?.ok) {
          setStatusMessage(resp?.error || "Could not load test task.");
          return;
        }

        setActiveTestTaskIndex(safeIndex);
        setTestTaskInput(String(safeIndex + 1));
        setWaitingForLaunch(false);
        setTaskLocked(false);
        setPostSubmitSecondsLeft(null);
        setReviewState(null);
        setScanError(null);
        setScanStatus("ok");

        if (testBypassScan) {
          setScannedStationId(
            assignedStationId ||
            normalizeStationId(assignedStationIdRef.current)?.id ||
            null
          );
          setScannerActive(false);
        }

        setStatusMessage(`Test task ${safeIndex + 1} loaded.`);
      }
    );
  }

    function goToPrevTestTask() {
    const current =
      typeof activeTestTaskIndex === "number"
        ? activeTestTaskIndex
        : (() => {
            const oneBased = Number(testTaskInput);
            return Number.isInteger(oneBased) && oneBased > 0 ? oneBased - 1 : 0;
          })();

    const nextIndex = Math.max(0, current - 1);
    setTestTaskInput(String(nextIndex + 1));
    requestTestTaskByIndex(nextIndex);
  }

  function goToNextTestTask() {
    const current =
      typeof activeTestTaskIndex === "number"
        ? activeTestTaskIndex
        : (() => {
            const oneBased = Number(testTaskInput);
            return Number.isInteger(oneBased) && oneBased > 0 ? oneBased - 1 : 0;
          })();

    const nextIndex =
      typeof totalTaskCount === "number"
        ? Math.min(totalTaskCount - 1, current + 1)
        : current + 1;

    setTestTaskInput(String(nextIndex + 1));
    requestTestTaskByIndex(nextIndex);
  }

  function clearTestTaskMode() {
    if (!roomCode || !teamId) {
      setActiveTestTaskIndex(null);
      return;
    }

    socket.emit(
      "task:testClear",
      {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
      },
      () => {
        setActiveTestTaskIndex(null);
        setTestTaskInput("");
        setTaskLocked(false);
        setPostSubmitSecondsLeft(null);
        setReviewState(null);
        setStatusMessage("Returned to live task flow.");
      }
    );
  }

  function handleTestTaskSelect(e) {
    const value = e.target.value;
    if (value === "") {
      setTestTaskInput("");
      return;
    }

    const idx = Number(value);
    if (!Number.isInteger(idx) || idx < 0) return;

    setTestTaskInput(String(idx + 1));
    requestTestTaskByIndex(idx);
  }

  // ─────────────────────────────────────────────
  // Join room + submit handlers
  // ─────────────────────────────────────────────

  const canJoin =
    roomCode.trim().length >= 2 &&
    // Team name can be blank (server will auto-assign for first-come teams).
    members.some((m) => (m?.name || m || "").toString().trim().length > 0);

  const handleJoinRoom = () => {
    // Extract names and emails from the per-member objects
    const memberNames = members
      .map((m) => (typeof m === "string" ? m : m?.name || "").trim())
      .filter(Boolean);
    const memberEmails = members
      .map((m) => {
        const email = (typeof m === "string" ? "" : m?.email || "").trim().toLowerCase();
        return email && email.includes("@") ? email : "";
      });
    // Also build a flat email list for backward compat (team-level)
    const cleanEmails = memberEmails.filter(Boolean);

    // Clear cached selfie if team name or player names changed
    try {
      const prevMembersRaw = lsGet(LS_KEYS.members);
      const prevParsed = prevMembersRaw ? JSON.parse(prevMembersRaw) : [];
      const prevNames = (Array.isArray(prevParsed) ? prevParsed : [])
        .map((n) => String(typeof n === "string" ? n : n?.name || "").trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join(",");
      const newNames = memberNames
        .map((n) => n.toLowerCase())
        .sort()
        .join(",");

      // Also check team name — selfie banner shows the team name
      const prevTeamName = (lsGet(LS_KEYS.teamName) || "").trim().toLowerCase();
      const newTeamName = (teamName || "").trim().toLowerCase();
      const teamNameChanged = prevTeamName && newTeamName && prevTeamName !== newTeamName;

      const memberNamesChanged = newNames && prevNames !== newNames;

      if (teamNameChanged || memberNamesChanged) {
        lsDel(LS_KEYS.selfieUrl);
        lsDel(LS_KEYS.themedSelfieUrl);
        console.log("[selfie] Cleared cached selfie —", teamNameChanged ? "team name changed" : "player names changed");
      }
    } catch (_) { /* non-critical */ }

    // Build memberDetails for per-member email tracking
    const memberDetails = members
      .filter((m) => (typeof m === "string" ? m : m?.name || "").trim())
      .map((m) => ({
        name: (typeof m === "string" ? m : m?.name || "").trim(),
        email: (typeof m === "string" ? "" : m?.email || "").trim().toLowerCase() || "",
      }));

    const payload = {
      roomCode: roomCode.trim().toUpperCase(),
      teamName: (teamName || "").trim(),
      members: memberNames,          // backward compat: string[]
      emails: cleanEmails,            // backward compat: string[]
      memberDetails,                  // NEW: per-member {name, email} pairs
      displayName: memberNames[0] || "",
      maxTeamSize: 8,
      locationSlug: roomLocation || DEFAULT_LOCATION,
    };

    setJoiningRoom(true);
    setStatusMessage("");

    socket.emit("student:join-room", payload, (response) => {
      setJoiningRoom(false);

      const ok = response && (response.ok === true || response.success === true);
      if (!ok) {
        setStatusMessage(response?.error || "Could not join. Check the code with your teacher.");
        return;
      }

      // core join state
      setJoined(true);
      setStatusMessage("");

      // Pipeline start: Join → Scan → Mood → Treasure → first task
      setPostPhase("scan");
      setTasksetComplete(false);
      setTaskRenderError(null);

      // scan/task flags
      setScannedStationId(null);
      setScanStatus(null);
      setScanError(null);
      setScannerActive(false); // enable after we confirm assignment
      setWaitingForLaunch(false);

      const tid = response.teamId || response.teamSessionId;
      setTeamId(tid);
      setTeamSessionId(response.teamSessionId || response.teamId || null);

      // If the server auto-assigned your team, update the UI to match
      if (response?.teamName) {
        setTeamName(String(response.teamName));
      }

      // ✅ Persist this join so refresh/reconnect can auto-resume.
      lsSet(LS_KEYS.roomCode, payload.roomCode);
      lsSet(LS_KEYS.teamSessionId, String(tid));
      lsSet(LS_KEYS.teamName, response?.teamName || payload.teamName || '');
      try {
        // Save in new {name,email} format so next load picks it up directly
        lsSet(LS_KEYS.members, JSON.stringify(memberDetails || []));
      } catch {}
      userDroppedRoomRef.current = false;
      resumeAttemptedRef.current = false;

      // -------------------------
      // Station assignment (color + stationId)
      // -------------------------
      const joinStationId = response?.stationId || response?.assignedStationId;
      if (joinStationId) {
        const stationInfo = normalizeStationId(joinStationId);
        // Prefer server-provided color over hardcoded index mapping
        const resolvedColor = response?.assignedColor || stationInfo.color || null;
        setAssignedStationId(stationInfo.id);
        setAssignedColor(resolvedColor);
        setDisplayAssignedStationId(stationInfo.id);
        setDisplayAssignedColor(resolvedColor);
        lastStationIdRef.current = stationInfo.id;
      } else if (response?.assignedColor) {
        setAssignedColor(String(response.assignedColor).toLowerCase());
        setDisplayAssignedColor(String(response.assignedColor).toLowerCase());
      }

      // location
      const locSlug =
        response.locationSlug || roomLocationFromStateRef.current || DEFAULT_LOCATION;
      setRoomLocation(locSlug);
      roomLocationFromStateRef.current = locSlug;

      // noise config
      const noiseCfg = response.noiseConfig || {};
      setNoiseState((prev) => ({
        ...prev,
        enabled: !!noiseCfg.enabled,
        threshold: typeof noiseCfg.threshold === "number" ? noiseCfg.threshold : 0,
      }));

      // -------------------------
      // Current task on join
      // We do NOT jump into real tasks; warm-up pipeline owns the start.
      // If backend sends MoodCheck-in as currentTask, allow it; otherwise ignore until Treasure requests.
      // -------------------------
      if (response.currentTask?.task) {
        const ct = response.currentTask.task;

        setCurrentTask(ct);
        setCurrentTaskIndex(
          typeof response.currentTask.taskIndex === "number" ? response.currentTask.taskIndex : null
        );
        setTasksetTotalTasks(
          typeof response.currentTask.totalTasks === "number" ? response.currentTask.totalTasks : null
        );
        // Team just joined and is seeing their first task
        teamTaskNumberRef.current = 1;
        setTeamTaskNumber(1);

        const limit = response.currentTask.timeLimitSeconds || null;
        setTimeLimitSeconds(limit);

          if (limit && limit > 0) {
            const endTime = Date.now() + limit * 1000;
            setRemainingMs(endTime - Date.now());
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = setInterval(() => {
              setRemainingMs((prev) => {
                if (!prev || prev <= 1000) {
                  clearInterval(countdownTimerRef.current);
                  return 0;
                }
                return prev - 1000;
              });
            }, 1000);
          } else {
            setRemainingMs(0);
          }
        } else {
          setCurrentTask(null);
          setCurrentTaskIndex(null);
          setTasksetTotalTasks(null);
          setTimeLimitSeconds(null);
          setRemainingMs(0);
        }

      // -------------------------
      // Turn on camera scanner if we have any assignment signal
      // -------------------------
      setTimeout(() => {
        const hasAssignment = !!(
          response?.stationId ||
          response?.assignedStationId ||
          response?.assignedColor
        );
        if (hasAssignment) setScannerActive(true);
      }, 0);
    });
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!canJoin || joiningRoom) return;
    handleJoinRoom();
  };

  // Explicit user action: drop current room and show the join form.
    // This is the ONLY time we clear saved join keys.
    const handleJoinAnotherRoom = () => {
      userDroppedRoomRef.current = true;
      resumeAttemptedRef.current = false;
      setWarmupDone(false);
      setWarmupStep("mood");

      clearSavedJoin();

      // reset core session state
      setJoined(false);
      setTeamId(null);
      setTeamSessionId(null);
      setStatusMessage("");

      // reset station/task/scanner state
      setAssignedStationId(null);
      setAssignedColor(null);
      setScannedStationId(null);
      setScannerActive(false);
      setScanError(null);
      setScanStatus(null);
      setWaitingForLaunch(false);

      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setTasksetTotalTasks(null);
      setTeamTaskNumber(0);
      teamTaskNumberRef.current = 0;
      setTimeLimitSeconds(null);
      setRemainingMs(0);
      setSubmitting(false);
      setCurrentAnswerDraft("");

      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);
      setLastTaskResult(null);
      setPointToast(null);
      setShortAnswerReveal(null);
      setReviewState(null);
      setTasksetComplete(false);
      setTaskRenderError(null);

      // reset pipeline
      setPostPhase("join");

      // clear join form fields (optional, but expected UX)
      setRoomCode("");
      setTeamName("");
      setMembers(["", "", ""]);
    };

    // ----------------------------------------------------
    // End the 15s review lock and return to scan state
    // (Used by BOTH the server-scored path and the fallback timer)
    // ----------------------------------------------------
    const endReviewAndReturnToScan = () => {
      // stop lock + countdown
      setTaskLocked(false);
      setPostSubmitSecondsLeft(null);
      setReviewState(null);

      // clear scan dedupe so the next state is fresh
      lastScanKeyRef.current = { key: null, atMs: 0 };

      // In mystery mode, the server controls "all boxes done" via mystery:timeUp,
      // so we never treat a single mystery task as "last" here.
      const isLastTask =
        !isMysteryModeRef.current &&
        typeof currentTaskIndex === "number" &&
        typeof tasksetTotalTasks === "number" &&
        currentTaskIndex >= 0 &&
        tasksetTotalTasks > 0 &&
        currentTaskIndex === tasksetTotalTasks - 1;

      // hide completed task UI
      setCurrentTask(null);
      setCurrentTaskIndex(null);
      setShortAnswerReveal(null);

      // clear transient scan UI
      setScanStatus(null);
      setScanError(null);
      setScannedStationId(null);
      setDisplayAssignedStationId(assignedStationIdRef.current || assignedStationId);
      setDisplayAssignedColor(assignedColorRef.current || assignedColor);

      if (isLastTask) {
        setPostPhase("feedback");
        setTasksetComplete(false);
        setScannerActive(false);
        setWaitingForLaunch(false);
        tryPlaySessionEndSound();

        socket.emit("room:request-state", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
        });
        return;
      }

      // If a task:assigned arrived while the review was locked, apply it now
      // so the student goes straight to the task (no extra scan needed for that queued task).
      const queued = pendingTaskAssignedRef.current;
      pendingTaskAssignedRef.current = null;
      if (queued) {
        handleTaskAssigned(queued);
        return;
      }

      // Mystery mode: go back to box grid instead of scanning
      // NOTE: use ref — this function is defined inside useEffect([teamId, roomCode]),
      // so the closure-captured `isMysteryMode` is stale (always the value from
      // the render when the effect last ran). The ref stays current.
      if (isMysteryModeRef.current) {
        setPostPhase("tasks");
        setScannerActive(false);
        setWaitingForLaunch(false);
        // Request an updated grid from the server
        socket.emit("mystery:requestGrid", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
        });
        return;
      }

      // Always require a fresh scan for the next station
      setPostPhase("scan");
      setScannerActive(true);
      setWaitingForLaunch(false);

      socket.emit("room:request-state", {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
      });
    };

    const debugForceEndTaskNow = () => {
      // Kill any overlay timers immediately
      try {
        if (postSubmitTimerRef.current) {
          clearInterval(postSubmitTimerRef.current);
          postSubmitTimerRef.current = null;
        }
      } catch {}

      // If we're currently showing a task, just bail out of it like the overlay finished.
      // This is client-side only (no scoring), but perfect for UI/debug speed.
      endReviewAndReturnToScan();
    };

    const handleSubmitAnswer = (answerPayload) => {
      if (!roomCode || !joined || submitting || taskLocked) return;

      // Determine payload type (warm-up tasks may submit without currentTask)
      const payloadType =
        (answerPayload && typeof answerPayload === "object" &&
          (answerPayload.type || answerPayload.taskType)) ||
        null;

      // Mood = advance to selfie (or skip to treasure if selfie already cached)
      if (payloadType === TASK_TYPES.MOOD_CHECKIN) {
        setSubmitting(false);
        setStatusMessage("");

        // In mystery mode with room already active, skip treasure (mystery
        // boxes replace it) but still show selfie if needed.
        if (isMysteryMode && roomIsActive) {
          const hasSelfie = !!(lsGet(LS_KEYS.selfieUrl));
          if (hasSelfie) {
            // Selfie cached and player names haven't changed (join handler
            // clears the cache when names differ) — go straight to grid.
            setWarmupStep("done");
            lsSet(LS_KEYS.warmupDone, "1");
            tasksStartedRef.current = true;
            setPostPhase("tasks");
            socket.emit("mystery:requestGrid", {
              roomCode: roomCode.trim().toUpperCase(),
              teamId,
            });
          } else {
            // Need a selfie first, then go to grid (treasure skipped).
            setWarmupStep("selfie");
            setPostPhase("selfie");
          }
          return;
        }

        const hasSelfie = !!(lsGet(LS_KEYS.selfieUrl));
        if (hasSelfie) {
          setWarmupStep("treasure");
          setPostPhase("treasure");
        } else {
          setWarmupStep("selfie");
          setPostPhase("selfie");
        }
        return;
      }

      // Treasure = score only, stay in treasure until task arrives
      if (!currentTask && payloadType === TASK_TYPES.TREASURE_RUNNER) {
        setSubmitting(false);
        setWarmupStep("done");
        lsSet(LS_KEYS.warmupDone, "1");
        setPostPhase("treasure");
        return;
      }

      // ----------------------------------------------------
      // Treasure Runner: allow submits even without currentTask
      // ----------------------------------------------------
      const isTreasure =
        payloadType === TASK_TYPES.TREASURE_RUNNER ||
        payloadType === "treasure-runner";

      if (!currentTask && isTreasure) {
        setSubmitting(true);

        const deltaRaw =
          answerPayload?.pointsEarned ??
          answerPayload?.points ??
          answerPayload?.scoreDelta ??
          0;

        const delta = Number(deltaRaw) || 0;
        if (delta) setScoreTotal((prev) => (typeof prev === "number" ? prev + delta : delta));

        try {
          socket.emit("score:add", {
            roomCode: roomCode.trim().toUpperCase(),
            teamId,
            delta,
            reason: "TreasureRunner",
            meta: answerPayload || null,
          });
          socket.emit("treasure:finish", {
            roomCode: roomCode.trim().toUpperCase(),
            teamId,
            ...answerPayload,
            delta,
          });
        } catch {}

        setSubmitting(false);
        return;
      }
    
      // Normalize multi-part payloads from TaskRunner (can be object or JSON string)
      let normalizedAnswer = answerPayload;
      if (typeof answerPayload === "string" && answerPayload.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(answerPayload);
          if (parsed && typeof parsed === "object") normalizedAnswer = parsed;
        } catch {
          // leave as string
        }
      }

      const resolvedTaskId =
        currentTask?._id ||
        currentTask?.id ||
        currentTask?.taskId ||
        (typeof currentTaskIndex === "number" ? `task-${currentTaskIndex}` : null);

      const payload = {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        taskId: resolvedTaskId,
        taskIndex:
          typeof currentTaskIndex === "number" && currentTaskIndex >= 0
            ? currentTaskIndex
            : null,
        answer: normalizedAnswer,
        timeMs:
          typeof taskStartedAtRef.current === "number"
            ? Date.now() - taskStartedAtRef.current
            : null,
      };

      

      // Save the last submission locally so we can show rich, task-specific feedback
      // when the server returns task:scored (e.g., MadDash best time + bonus).
      lastSubmissionRef.current = {
        taskType: currentTask?.taskType || currentTask?.type || null,
        taskId: currentTask?._id || currentTask?.id || null,
        answer: normalizedAnswer,
      };

      console.log("[task:submit payload]", {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        taskId: currentTask?._id || currentTask?.id,
        taskIndex: currentTaskIndex,
        currentTaskType: currentTask?.taskType || currentTask?.type,
        normalizedAnswer,
      });

      setSubmitting(true);
      // Pre-lock: set taskLocked BEFORE emitting so that the room:state
      // broadcast (which arrives before the ack) can't clear currentTask.
      // If submission fails, the ack error handler will unlock.
      setTaskLocked(true);
      taskLockedRef.current = true;

      // Safety net: if the socket callback never fires (network drop, server crash),
      // unlock after 30s so the student isn't permanently stuck.
      // (AI-scored tasks like short-answer can take 15-20s, so 12s was too aggressive.)
      let submitAcked = false;
      const submitSafetyTimer = setTimeout(() => {
        if (submitAcked) return;
        console.warn("[task:submit] No ack after 30s — forcing unlock");
        setSubmitting(false);
        setTaskLocked(false);
        taskLockedRef.current = false;
        setStatusMessage("Submission timed out — moving on.");
        endReviewAndReturnToScan();
      }, 30000);

      socket.emit("task:submit", payload, (response) => {
        submitAcked = true;
        clearTimeout(submitSafetyTimer);
        if (!response || response.error) {
          console.warn("Submit error:", response?.error || "Unknown error");
          setSubmitting(false);
          setTaskLocked(false);
          taskLockedRef.current = false;
          setStatusMessage(response?.error || "There was a problem submitting. Try again.");
          return;
        }

        setSubmitting(false);
        setStatusMessage("");
        try {
        if (response?.testMode) {
          setStatusMessage(
            response?.localOnly
              ? "Test submission scored locally."
              : "Test submission completed."
          );
        }

        // Update next station from ack so it's ready when review ends
        // (prevents race condition with room:state arriving late)
        // IMPORTANT: also write refs immediately so endReviewAndReturnToScan
        // picks up the new color (useEffect sync hasn't fired yet in this tick).
        if (response?.nextStationId) {
          const nextNorm = normalizeStationId(response.nextStationId);
          if (nextNorm?.id) {
            // Prefer server-provided color over hardcoded index mapping
            const nextColor = response.nextStationColor || nextNorm.color || null;
            setAssignedStationId(nextNorm.id);
            setAssignedColor(nextColor);
            assignedStationIdRef.current = nextNorm.id;
            assignedColorRef.current = nextColor;
            lastStationIdRef.current = nextNorm.id;
          }
        } else if (response?.nextStationColor) {
          setAssignedColor(response.nextStationColor);
          assignedColorRef.current = response.nextStationColor;
        }

        const currentType = currentTask?.taskType || currentTask?.type;

        const isPhysical =
          !!currentTask?.isPhysical ||
          !!currentTask?.config?.isPhysical ||
          currentTask?.category === "PHYSICAL" ||
          currentType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE ||
          currentType === TASK_TYPES.MAD_DASH ||
          currentType === TASK_TYPES.MAD_DASH_SEQUENCE;
          
        if (!isPhysical) {
          // If there is no scoring overlay to show, do NOT pause for "review".
          // (Example: objectiveScoring=false AND aiScoring=false)
          const objectiveFlag =
            (typeof currentTask?.objectiveScoring === "boolean"
              ? currentTask.objectiveScoring
              : (typeof currentTask?.config?.objectiveScoring === "boolean"
                  ? currentTask.config.objectiveScoring
                  : undefined));

          const aiFlag =
            (typeof currentTask?.aiScoring === "boolean"
              ? currentTask.aiScoring
              : (typeof currentTask?.config?.aiScoring === "boolean"
                  ? currentTask.config.aiScoring
                  : (typeof currentTask?.aiScoringRequired === "boolean"
                      ? currentTask.aiScoringRequired
                      : undefined)));

          const disableReviewPause = objectiveFlag === false && aiFlag === false;

          if (disableReviewPause) {
            // No correct answers / rubric / scoring overlay to review -> return to scan immediately.
            setReviewState(null);
            setPostSubmitSecondsLeft(null);
            setTaskLocked(false);
            if (postSubmitTimerRef.current) {
              clearInterval(postSubmitTimerRef.current);
              postSubmitTimerRef.current = null;
            }
            endReviewAndReturnToScan();
            return;
          }

          const reviewObj =
            response?.review && typeof response.review === "object"
              ? { ...response.review }
              : {
                  feedback: response?.feedback,
                  hint: response?.hint,
                  modelAnswer: response?.modelAnswer,
                  comment: response?.comment,
                };

          // ── Map AI-scoring fields to display fields if not already set ──
          // Backend sends aiFeedback / aiSuggestedAnswer / aiHint; display expects feedback / modelAnswer / hint.
          if (!reviewObj.feedback && reviewObj.aiFeedback) {
            reviewObj.feedback = reviewObj.aiFeedback;
          }
          if (!reviewObj.modelAnswer && reviewObj.aiSuggestedAnswer) {
            reviewObj.modelAnswer = reviewObj.aiSuggestedAnswer;
          }
          if (!reviewObj.hint && reviewObj.aiHint) {
            reviewObj.hint = reviewObj.aiHint;
          }
          // Also pull aiFeedback off the top-level aiScore if the review didn't carry it
          if (!reviewObj.feedback && response?.aiScore?.aiFeedback) {
            reviewObj.feedback = response.aiScore.aiFeedback;
          }
          if (!reviewObj.feedback && response?.aiScore?.feedback) {
            reviewObj.feedback = response.aiScore.feedback;
          }
          if (!reviewObj.feedback && response?.aiScore?.reason) {
            reviewObj.feedback = response.aiScore.reason;
          }
          if (!reviewObj.feedback && response?.aiScore?.rationale) {
            reviewObj.feedback = response.aiScore.rationale;
          }
          if (!reviewObj.hint && response?.aiScore?.hint) {
            reviewObj.hint = response.aiScore.hint;
          }
          if (!reviewObj.modelAnswer && response?.aiScore?.modelAnswer) {
            reviewObj.modelAnswer = response.aiScore.modelAnswer;
          }

          const accepted =
            typeof response?.accepted === "boolean"
              ? response.accepted
              : (typeof response?.correct === "boolean" ? response.correct : false);

          const studentText =
            typeof normalizedAnswer === "string"
              ? normalizedAnswer.trim()
              : "";

          // Record Audio: always give at least a success acknowledgement
          if (currentType === TASK_TYPES.RECORD_AUDIO || currentType === "record-audio") {
            if (
              !reviewObj.feedback &&
              !reviewObj.hint &&
              !reviewObj.modelAnswer &&
              !reviewObj.comment
            ) {
              reviewObj.feedback = "Your recording was submitted successfully.";
            }
          }

          // Open Text: always give at least a response
          if (currentType === TASK_TYPES.OPEN_TEXT || currentType === "open-text") {
            if (
              !reviewObj.feedback &&
              !reviewObj.hint &&
              !reviewObj.modelAnswer &&
              !reviewObj.comment
            ) {
              reviewObj.feedback = "Thanks — your response was submitted.";
            }
          }

          // Reading Comp: ensure there's always feedback for the reader
          if (currentType === TASK_TYPES.READING_COMP || currentType === "reading-comp") {
            if (
              !reviewObj.feedback &&
              !reviewObj.hint &&
              !reviewObj.modelAnswer &&
              !reviewObj.comment
            ) {
              reviewObj.feedback = accepted
                ? "Nice work — your answer shows good comprehension."
                : "Good try — look for the main idea in the paragraph next time.";
            }
          }

          // Short Answer: if we pause, we must show feedback
          if (
            currentType === TASK_TYPES.SHORT_ANSWER &&
            !reviewObj.feedback &&
            !reviewObj.hint &&
            !reviewObj.modelAnswer &&
            !reviewObj.comment
          ) {
            if (accepted) {
              reviewObj.feedback = studentText
                ? `Good job — you said: "${studentText}".`
                : "Good job — your answer was accepted.";
            } else {
              reviewObj.feedback = studentText
                ? `You said: "${studentText}".`
                : "Thanks for your answer.";
              reviewObj.hint = "Try adding the main idea more clearly.";
            }
          }

          // Only decide review AFTER all fallback feedback has been added
          const hasMeaningfulFeedback = !!(
            reviewObj.feedback ||
            reviewObj.hint ||
            reviewObj.modelAnswer ||
            reviewObj.comment ||
            reviewObj.aiFeedback
          );

          // Objective tasks always get a review window (to show the answer key overlay)
          const isObjCurrentTask = isObjectiveTask(currentTask);

          // DrawMime has its own built-in reveal/review phase — no need for the overlay.
          // Check all possible taskType variants (DB may store draw_mime, draw-or-mime, etc.)
          const dmType = (currentTask?.taskType || currentTask?.type || "").toLowerCase().replace(/[_\s]/g, "-");
          const isDrawMimeTask =
            dmType === "draw-mime" ||
            dmType === "draw-or-mime" ||
            dmType === "drawormime" ||
            dmType === "draw" ||
            dmType === "mime";

          // Skipped tasks: no review overlay — advance immediately
          const wasSkipped = response?.skipped === true;

          const shouldShowReview =
            !wasSkipped &&
            !isPhysical &&
            !isDrawMimeTask &&
            (isObjCurrentTask || !accepted || hasMeaningfulFeedback);

          if (!shouldShowReview) {
            setReviewState(null);
            setPostSubmitSecondsLeft(null);
            setTaskLocked(false);
            taskLockedRef.current = false;
            if (postSubmitTimerRef.current) {
              clearInterval(postSubmitTimerRef.current);
              postSubmitTimerRef.current = null;
            }
            endReviewAndReturnToScan();
            return;
          }

          setTaskLocked(true);

          // Check if team is catching up for quickened review
          const isCatchingUp = response?.catchUp === true;
          const fallbackSeconds = isCatchingUp
            ? (response?.catchUpReviewSeconds || 4)
            : (Number(response?.postSubmitSeconds) > 0
              ? Number(response.postSubmitSeconds)
              : DEFAULT_POST_SUBMIT_SECONDS);

          const earnedPts = typeof response?.points === "number" ? response.points : 0;
          const spdBonus = typeof response?.speedBonus === "number" ? response.speedBonus : 0;

          // Increment task-completion counter for reader rotation
          tasksCompletedCountRef.current += 1;

          // Pick reader ONCE (stable across re-renders)
          const namedMembers = Array.isArray(memberNames)
            ? memberNames.map((n) => String(n || "").trim()).filter(Boolean)
            : [];
          let pickedReader = null;
          if (namedMembers.length === 1) {
            pickedReader = namedMembers[0];
          } else if (namedMembers.length > 1) {
            const candidates = namedMembers.filter((n) => n !== lastReaderRef.current);
            pickedReader = candidates[Math.floor(Math.random() * candidates.length)];
          }
          if (pickedReader) lastReaderRef.current = pickedReader;

          setReviewState({
            ...reviewObj,
            reader: pickedReader,
            correct: typeof response?.correct === "boolean" ? response.correct : undefined,
            accepted:
              typeof response?.accepted === "boolean"
                ? response.accepted
                : (typeof response?.correct === "boolean" ? response.correct : undefined),
            points: earnedPts,
            speedBonus: spdBonus,
            studentAnswer: normalizedAnswer,
            taskId: payload.taskId,
            taskIndex: payload.taskIndex,
            secondsLeft: fallbackSeconds,
            isCatchingUp: isCatchingUp,
          });

          // Celebration: confetti + yay sound for big scores
          if (earnedPts >= 80) {
            tryPlayYaySound();
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 2000);
          } else if (accepted) {
            tryPlayCorrectSound();
          } else if (earnedPts > 0) {
            tryPlayCorrectSound();
          } else {
            tryPlayWrongSound();
          }

          setPostSubmitSecondsLeft(fallbackSeconds);

          if (postSubmitTimerRef.current) clearInterval(postSubmitTimerRef.current);

          let t = fallbackSeconds;
          const timer = setInterval(() => {
            t -= 1;
            setPostSubmitSecondsLeft(t);
            if (t <= 0) {
              clearInterval(timer);
              // For tasks with a feedback panel (short-answer, open-text, record-audio),
              // wait for student to tap "Read it" button.
              // For all other tasks, auto-advance since there's no feedback to read.
              const feedbackTaskTypes = ["short-answer", "open-text", "record-audio", "reading-comp"];
              const ct = currentTaskRef.current?.taskType || "";
              const hasFeedbackPanel = feedbackTaskTypes.includes(ct);
              if (!hasFeedbackPanel) {
                endReviewAndReturnToScan();
              }
              // else: "Read it" button will appear in the feedback panel
            }
          }, 1000);

          postSubmitTimerRef.current = timer;

        } else {
          // ✅ PHYSICAL TASK: no overlay, go straight to scan
          setTaskLocked(false);
          taskLockedRef.current = false;
          setReviewState(null);
          setPostSubmitSecondsLeft(null);
          endReviewAndReturnToScan();
          return;
        }

        if (response.alertSound) {
          tryPlayAlertSound();
        }
        } catch (err) {
          console.error("[task:submit callback] Error in post-submit processing:", err);
          // If something threw after setSubmitting(false), ensure we still progress
          // by going to scan screen rather than leaving the user stuck
          try {
            setTaskLocked(false);
            setReviewState(null);
            setPostSubmitSecondsLeft(null);
            endReviewAndReturnToScan();
          } catch (e2) {
            console.error("[task:submit callback] Recovery also failed:", e2);
          }
        }
      });
    };

  // ─────────────────────────────────────────────
  // QR Scanner
  // ─────────────────────────────────────────────

  const handleScan = (data) => {
    console.log("[SCAN] enter", {
      data,
      joined,
      teamId,
      taskLocked,
      mustScan,
      scannerActive,
      currentTaskType: currentTaskRef.current?.taskType || currentTaskRef.current?.type || null,
      assignedStationId,
      scannedStationId,
      assignedColor,
    });

    if (!data || !joined || !teamId) return false;

    // De-dupe repeated reads of the same QR (camera often detects the same code many frames in a row).
    // Use normalized station id when possible so URLs/colors collapse to a single key.
    const scanKey = (() => {
      try {
        const n = normalizeStationId(data);
        return String(n?.id || data).trim().toLowerCase();
      } catch {
        return String(data).trim().toLowerCase();
      }
    })();

    const now = Date.now();
    const last = lastScanKeyRef.current;
    // Shorter dedup window during task-scanner types (MadDash/PMC) for snappier scanning;
    // longer window for station navigation scans to avoid double-taps.
    const liveTaskPeek = currentTaskRef.current;
    const peekType = String(liveTaskPeek?.taskType || liveTaskPeek?.type || "").toLowerCase().replace(/_/g, "-");
    const isTaskScanner = peekType === "physical-multiple-choice" || peekType === "mad-dash" || peekType === "mad-dash-sequence";
    const dedupMs = isTaskScanner ? 400 : 1200;
    if (last?.key === scanKey && now - (last?.atMs || 0) < dedupMs) {
      return false;
    }
    lastScanKeyRef.current = { key: scanKey, atMs: now };

    // Ignore scans only if a NON-physical-MC task is currently on screen (or we're in locked review).
    // We MUST allow scans during PhysicalMultipleChoiceTask so it can receive station colors.
    const liveTask = currentTaskRef.current;
    const rawType = liveTask?.taskType || liveTask?.type || "";
    const liveTypeNorm = String(rawType).toLowerCase().replace(/_/g, "-");

    const isPMC = liveTypeNorm === "physical-multiple-choice";
    const isMadDash =
      liveTypeNorm === "mad-dash" ||
      liveTypeNorm === "mad-dash-sequence";
      
    // Block scans while locked review, but keep the camera alive.
    if (taskLocked) {
      setScanError(null);
      setScannerActive(true);
      return false;
    }

    const isTaskScannerType =
      liveTypeNorm === "physical-multiple-choice" ||
      liveTypeNorm === "mad-dash" ||
      liveTypeNorm === "mad-dash-sequence";

    // If a task wants scanner input, give it first.
    // For PMC / MadDash, NEVER let scans fall through to server station:scan.
    try {
      if (isTaskScannerType) {
        const norm = normalizeStationId(data);
        const taskScanValue = norm?.color || data;

        console.log("[SCAN task handler check]", {
          liveTypeNorm,
          hasHandler: typeof window.__curriculateTaskScanHandler === "function",
          taskWantsScan: window.__curriculateTaskWantsScan,
          currentTaskType: currentTaskRef.current?.taskType || currentTaskRef.current?.type || null,
          taskScanValue,
        });
        
        let consumed = false;
        if (typeof window.__curriculateTaskScanHandler === "function") {
          consumed = window.__curriculateTaskScanHandler(taskScanValue) === true;
          console.log("[SCAN PMC result]", {
            taskScanValue,
            consumed,
            wantsScan: window.__curriculateTaskWantsScan,
          });
        }

        if (liveTypeNorm === "physical-multiple-choice") {
          if (!norm?.color) {
            setScanStatus(null);
            setScanError("Not a valid station color.");
            setScannerActive(true);
            return false;
          }

          if (consumed) {
            setScanError(null);
            setScannerActive(true);
            return false;
          }

          // not consumed by PMC
          setScanStatus(null);
          setScanError(null);
          setScannerActive(true);
          return false;
        }

        setScanError(null);
        setScannerActive(true);
        return false;
      }

      if (window.__curriculateTaskWantsScan && typeof window.__curriculateTaskScanHandler === "function") {
        const consumed = window.__curriculateTaskScanHandler(data);
        if (consumed === true) {
          setScanError(null);
          return false;
        }
      }
    } catch (e) {
      console.warn("Task scan handler error:", e);
      if (isTaskScannerType) {
        setScannerActive(true);
        return false;
      }
    }
    
    // If a task is on screen:
    // - Physical MC: allow scans and forward to the task via window event
    // - Everything else: ignore scans (prevents accidental station gate scans mid-task)
    //
    // IMPORTANT: When we're scan-gated (`mustScan`), we still need to accept the scan to unlock
    // the already-assigned next task (or a hard-locked task). So only ignore scans mid-task when
    // scanning is NOT currently required.
    if (
      liveTask &&
      !mustScan &&
      !isPMC &&
      !isMadDash
    ) {
      setScanError(null);
      setScannerActive(true);
      return false;
    }

    const norm = normalizeStationId(data);
    if (!norm?.id) {
      setScanError("Unrecognized station CurricQR code.");
      return false;
    }

    const code = (roomCode || "").trim().toUpperCase();

    // Avoid TDZ: do NOT reference isMultiRoom here (it's declared later)
    const multi = Array.isArray(selectedRooms) && selectedRooms.length > 1;

    const scanPayload = {
      roomCode: code,
      teamId,
      stationId: norm.id,
    };

    // Only include locationSlug when it should be enforced (multi-room hunts)
    if (enforceLocation && multi) {
      scanPayload.locationSlug = (roomLocation || "").trim().toLowerCase().replace(/\s+/g, "-");
    }

    if (stationScanInFlightRef.current) {
      return false;
    }
    stationScanInFlightRef.current = true;
    let inFlightResetTimer = null;
    try {
      inFlightResetTimer = window.setTimeout(() => {
        stationScanInFlightRef.current = false;
      }, 6000);
    } catch {}

    socket.emit("station:scan", scanPayload, (resp) => {
      stationScanInFlightRef.current = false;
      try {
        if (inFlightResetTimer) window.clearTimeout(inFlightResetTimer);
      } catch {}

      if (!resp || resp.ok === false) {
        setScanStatus("error");
        setWaitingForLaunch(false);
        setScannedStationId(null);
        setScanError(resp?.error || "Not quite — try again!");
        setScannerActive(true);
        return;
      }

      setScanError(null);

      // Server already accepted the scan, so trust it.
      // Also refresh local assigned station if the server sends one back.
      if (resp?.stationId) {
        const serverStation = normalizeStationId(resp.stationId);
        if (serverStation?.id) {
          setAssignedStationId(serverStation.id);
          setAssignedColor(serverStation.color || null);
          lastStationIdRef.current = serverStation.id;
        }
      }

      setScanStatus("ok");
      setScanError(null);
      setScannedStationId(
        resp?.stationId ? normalizeStationId(resp.stationId).id : norm.id
      );
      setScannerActive(true);

      const waiting = !!resp?.waitingForLaunch;

      if (resp?.task) {
        // ✅ Task is launching right now, so do not fire the global
        // station-entry celebration sound here.
        handleTaskAssigned({
          task: resp.task,
          taskIndex: resp.taskIndex,
          totalTasks: resp.totalTasks,
          timeLimitSeconds: resp.timeLimitSeconds,
          testMode: resp.testMode,
          bypassScan: resp.bypassScan,
        });
        setWaitingForLaunch(false);
      } else {
        tryPlayAlertSound();

        // In mystery mode with room already active, fresh joins still need
        // warmup (mood check) before seeing the grid. Don't just wait.
        const freshMysteryJoin = isMysteryMode && roomIsActive && warmupStep === "mood";

        if (freshMysteryJoin) {
          // Go straight to mood check — treasure will be skipped after mood
          // because the room is already active (mystery boxes replace treasure).
          setPostPhase("mood");
          setWaitingForLaunch(false);
        } else {
          setWaitingForLaunch(
            waiting || roomIsActive || tasksStartedRef.current || tasksStarted
          );

          if (!(roomIsActive || tasksStartedRef.current || tasksStarted)) {
            if (warmupStep === "done") setPostPhase("treasure");
            else setPostPhase("mood");
          }
        }
      }
    });

    return false;
  };

  // ─────────────────────────────────────────────
  // Physical Multiple Choice scan loop
  // After an accepted answer scan, keep the global scanner alive.
  // PMC task dispatches: "curriculate:pmcAnswerResult"
  // detail: { accepted: boolean, correct: boolean, done: boolean }
  // ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (ev) => {
      const d = ev?.detail || {};
      if (!d?.accepted) return;

      setScanError(null);
      setScanStatus(d.correct ? "ok" : "error");
      setScannerActive(true);
    };

    window.addEventListener("curriculate:pmcAnswerResult", handler);
    return () => {
      window.removeEventListener("curriculate:pmcAnswerResult", handler);
      try {
        if (pmcRescanTimerRef.current) clearTimeout(pmcRescanTimerRef.current);
      } catch {}
      pmcRescanTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!joined) return;
    if (currentTask) return;
    if (!teamId || !roomCode) return;

    // Mystery box mode: tasks are dispatched via box opens, not requestNext
    if (isMysteryMode) return;

    // NEVER overwrite feedback/trophy phase after last task
    if (tasksetComplete) return;
    if (postPhase === "feedback" || postPhase === "trophy") return;

    // only when scan gate is satisfied
    if (scannedStationId !== assignedStationId) return;

    // only after launch (or once tasks have started)
    if (!roomIsActive && !tasksStartedRef.current && !tasksStarted) return;

    const now = Date.now();
    if (now - lastRequestNextAtRef.current < 1200) return;
    lastRequestNextAtRef.current = now;

    setPostPhase("tasks");
    setWaitingForLaunch(true); // shows "Getting your first activity ready…" while we fetch
    socket.emit("task:requestNext", {
      roomCode: roomCode.trim().toUpperCase(),
      teamId,
    });
  }, [
    joined,
    currentTask,
    teamId,
    roomCode,
    scannedStationId,
    assignedStationId,
    roomIsActive,
    tasksStarted,
    tasksetComplete,
    postPhase,
    isMysteryMode,
  ]);

  // ─────────────────────────────────────────────
  // Derived values for UI
  // ─────────────────────────────────────────────
  const stationInfo = normalizeStationId(displayAssignedStationId || assignedStationId);

  const stationIndex = (() => {
    const m = /^station-(\d+)$/.exec(String(stationInfo?.id || ""));
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(0, Math.min(7, n - 1)); // clamp 0..7
  })();

  // ✅ Recreate the destination text after stationInfo exists
  const expectedLoc =
    roomState?.teams?.[teamId]?.locationSlug ||
    roomState?.teams?.[teamId]?.locationCode ||
    roomState?.locationCode ||
    "Classroom";

  const expectedRoom = displayRoomFromSlugOrLabel(expectedLoc, selectedRooms);
  const expectedColor = (displayAssignedColor || stationInfo?.color || "").toUpperCase();

  const destinationText =
    enforceLocation && Array.isArray(selectedRooms) && selectedRooms.length > 1
      ? `${expectedRoom} ${expectedColor}`
      : `${expectedColor}`;

  const themedTask = currentTask
    ? {
        ...currentTask,
        locationSlug: normalizeLocationSlug(roomLocation),
        stationId: stationInfo?.id || null,
        stationColor: displayAssignedColor || stationInfo?.color || null,
        stationIndex, // <-- Hangman uses this to select wordsByStation[stationIndex]
      }
    : null;

  const yourTeamName = teamName || "";
  const recentlyScoredBig = false; // or compute from lastTaskResult/pointToast if you already track it

  // Team selfie URL for banner avatar (themed preferred, fallback to original, then localStorage)
  const myTeamState = roomState?.teams?.[teamId];
  const teamSelfieUrl =
    myTeamState?.themedSelfieUrl ||
    myTeamState?.selfieUrl ||
    lsGet(LS_KEYS.themedSelfieUrl) ||
    lsGet(LS_KEYS.selfieUrl) ||
    null;

  const isMultiRoom = Array.isArray(selectedRooms) && selectedRooms.length > 1;

  const noiseBarOpacity = noiseState.enabled ? noiseState.brightness : 0.08;
  // Dim screen when class is noisy — floor at 0.35 so the effect is very noticeable
  const uiBrightness = noiseState.enabled
    ? Math.max(0.35, Math.min(typeof noiseState.brightness === "number" ? noiseState.brightness : 1, 1))
    : 1;

  const timerDisplay = timeLimitSeconds ? formatRemainingMs(remainingMs) : null;

  const responseFontSize = currentTask && currentTask.largeText ? "1.1rem" : "1rem";
  const responseHeadingFontSize = currentTask && currentTask.largeText ? "1.4rem" : "1.2rem";

  const isMotionMission = currentTask?.taskType === TASK_TYPES.MOTION_MISSION;
  const isPetFeeding = currentTask?.taskType === TASK_TYPES.PET_FEEDING;
  const isRecordAudio = currentTask?.taskType === TASK_TYPES.RECORD_AUDIO;
  const isAIDebateJudge =
    currentTask?.taskType === TASK_TYPES.AI_DEBATE_JUDGE ||
    currentTask?.taskType === "ai-debate-judge" ||
    currentTask?.taskType === "ai_debate_judge";

  const isJeopardy = currentTask?.taskType === TASK_TYPES.BRAINSTORM_BATTLE;
  const isFlashcardsRace = currentTask?.taskType === TASK_TYPES.FLASHCARDS_RACE;
  const isMadDash =
    currentTask?.taskType === TASK_TYPES.MAD_DASH ||
    currentTask?.taskType === TASK_TYPES.MAD_DASH_SEQUENCE;

  const isMakeAndSnap = currentTask?.taskType === TASK_TYPES.MAKE_AND_SNAP;

  const isEchoChain = currentTask?.taskType === TASK_TYPES.ECHO_CHAIN;

  const isScriptPlay =
    currentTask?.taskType === TASK_TYPES.SCRIPT_PLAY ||
    currentTask?.taskType === "script-play";

  const isNarrationSynthesize =
    currentTask?.taskType === TASK_TYPES.NARRATION_SYNTHESIZE ||
    currentTask?.taskType === "narration-synthesize";

  const isRolePlayDeck =
    currentTask?.taskType === TASK_TYPES.ROLE_PLAY_DECK ||
    currentTask?.taskType === "role-play-deck";

  const isFakeOut =
    currentTask?.taskType === TASK_TYPES.FAKE_OUT ||
    currentTask?.taskType === "fake-out";

  const isWordWeaver =
    currentTask?.taskType === TASK_TYPES.WORD_WEAVER_DUEL ||
    currentTask?.taskType === "word-weaver-duel" ||
    currentTask?.taskType === "word-weaver" ||
    currentTask?.taskType === "wordweaver";

  const isMindMapper = currentTask?.taskType === TASK_TYPES.MIND_MAPPER;

  const isHangman =
    currentTask?.taskType === TASK_TYPES.HANGMAN_DUEL || currentTask?.taskType === "hangman-duel";

  const isMultipleChoice = currentTask?.taskType === TASK_TYPES.MULTIPLE_CHOICE;

  
  const isPhysicalMultipleChoice = currentTask?.taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;
  
  const currentLiveType = currentTask?.taskType || currentTask?.type;
  const taskNeedsGlobalScanner =
    currentLiveType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE ||
    currentLiveType === TASK_TYPES.MAD_DASH ||
    currentLiveType === TASK_TYPES.MAD_DASH_SEQUENCE;
    
  const isMusicalChairs = currentTask?.taskType === TASK_TYPES.MUSICAL_CHAIRS;

  const musicalChairsHeaderStyle = isMusicalChairs
    ? {
        animation: "mc-header-pulse 1.4s ease-in-out infinite",
      }
    : {};

  const isMysteryClues = currentTask?.taskType === TASK_TYPES.MYSTERY_CLUES;

  const mysteryHeaderStyle = isMysteryClues
    ? {
        animation: "mystery-glow 1.6s ease-in-out infinite",
      }
    : {};

  const echoHeaderStyle = isEchoChain
    ? {
        animation: "echo-glow 1.35s ease-in-out infinite",
      }
    : {};

  const narrationHeaderStyle = isNarrationSynthesize
    ? {
        animation: "narration-glow 1.5s ease-in-out infinite",
      }
    : {};

  const hangmanHeaderStyle = isHangman
    ? {
        animation: "hangman-pulse 1.25s ease-in-out infinite",
      }
    : {};

  const isPhotoJournal =
    currentTask?.taskType === TASK_TYPES.PHOTO_JOURNAL ||
    currentTask?.taskType === "photo-journal" ||
    currentTask?.taskType === "photo_journal";

  const isVennSort =
    currentTask?.taskType === TASK_TYPES.VENNSORT ||
    currentTask?.taskType === "vennsort" ||
    currentTask?.taskType === "venn-sort";

  const isSpeedDraw =
    currentTask?.taskType === TASK_TYPES.SPEED_DRAW ||
    currentTask?.taskType === "speed-draw" ||
    currentTask?.taskType === "speeddraw";

  const isHideNSeek =
    currentTask?.taskType === TASK_TYPES.HIDENSEEK ||
    currentTask?.taskType === "hidenseek" ||
    currentTask?.taskType === "hide-n-seek";

  const isReadingComp =
    currentTask?.taskType === TASK_TYPES.READING_COMP ||
    currentTask?.taskType === "reading-comp" ||
    currentTask?.taskType === "reading-comprehension" ||
    currentTask?.taskType === "readingcomprehension";

  const isPhysicalTask =
    !!currentTask?.isPhysical ||
    !!currentTask?.config?.isPhysical ||
    currentTask?.category === "PHYSICAL";

  // MC, TF, short-answer, and reading-comp review is handled inline — not via the floating overlay.
  // MC/TF: TaskRunner shows green/red highlights.
  // Short-answer/reading-comp: feedback shows inline below the answer boxes.
  // Suppress the StudentApp lock overlay for all these types to avoid ghosted double-rendering.
  const taskRunnerOwnsReview =
    currentTask?.taskType === TASK_TYPES.MULTIPLE_CHOICE ||
    currentTask?.taskType === TASK_TYPES.TRUE_FALSE ||
    currentTask?.taskType === TASK_TYPES.SHORT_ANSWER ||
    currentTask?.taskType === TASK_TYPES.READING_COMP ||
    currentTask?.taskType === TASK_TYPES.OPEN_TEXT ||
    currentTask?.taskType === TASK_TYPES.RECORD_AUDIO;

  const _dmT = (currentTask?.taskType || currentTask?.type || "").toLowerCase().replace(/[_\s]/g, "-");
  const isDrawMime = _dmT === "draw-mime" || _dmT === "draw-or-mime" || _dmT === "drawormime" || _dmT === "draw" || _dmT === "mime";
  const isLiveDebate = currentTask?.taskType === TASK_TYPES.LIVE_DEBATE;

  const isOpenText = currentTask?.taskType === TASK_TYPES.OPEN_TEXT;
  const isPhoto = currentTask?.taskType === TASK_TYPES.PHOTO;
  const isBrainSparkNotes = currentTask?.taskType === TASK_TYPES.BRAIN_SPARK_NOTES;

  const baseTaskCardStyle = {
    marginBottom: 12,
    padding: 14,
    borderRadius: 20,
    boxShadow: "0 10px 25px rgba(15,23,42,0.18)",
    border: "1px solid rgba(129,140,248,0.35)",
  };

  const taskCardBackground = isFlashcardsRace
    ? "linear-gradient(135deg, #0f172a 0%, #1d4ed8 35%, #a855f7 70%, #f97316 100%)"
    : isMadDash
    ? "linear-gradient(135deg, #b91c1c 0%, #f97316 40%, #facc15 80%)"
    : isMakeAndSnap
    ? "linear-gradient(135deg, #14b8a6 0%, #38bdf8 40%, #e0f2fe 100%)"
    : (isMultipleChoice || isPhysicalMultipleChoice)
    ? "linear-gradient(135deg, #22c55e 0%, #0ea5e9 40%, #eef2ff 100%)"
    : isDrawMime
    ? "linear-gradient(135deg, #fef3c7 0%, #fee2e2 40%, #f9fafb 100%)"
    : isLiveDebate
    ? "linear-gradient(135deg, #0f172a 0%, #fb7185 35%, #f97316 70%, #facc15 100%)"
    : isMindMapper
    ? "linear-gradient(135deg, #0f172a 0%, #22c55e 35%, #06b6d4 70%, #e0f2fe 100%)"
    : isMusicalChairs
    ? "linear-gradient(135deg, #f97316 0%, #ec4899 35%, #8b5cf6 70%, #fef3c7 100%)"
    : isMysteryClues
    ? "linear-gradient(135deg, #020617 0%, #1e293b 30%, #4f46e5 65%, #22c55e 100%)"
    : isOpenText
    ? "linear-gradient(135deg, #e0f2fe 0%, #f5f3ff 40%, #f9fafb 100%)"
    : isPhoto
    ? "linear-gradient(135deg, #0f172a 0%, #38bdf8 40%, #e0f2fe 100%)"
    : isPhotoJournal
    ? "linear-gradient(135deg, #0f172a 0%, #1d4ed8 35%, #a855f7 70%, #f97316 100%)"
    : isVennSort
    ? "linear-gradient(135deg, #0f172a 0%, #22c55e 35%, #06b6d4 70%, #e0f2fe 100%)"
    : isSpeedDraw
    ? "linear-gradient(135deg, #fef9c3 0%, #60a5fa 35%, #a855f7 70%, #f97316 100%)"
    : isHideNSeek
    ? "linear-gradient(135deg, #020617 0%, #0ea5e9 35%, #22c55e 70%, #fef3c7 100%)"
    : isHangman
    ? "linear-gradient(135deg, #0f172a 0%, #22c55e 35%, #facc15 70%, #f97316 100%)"
    : isBrainSparkNotes
    ? "linear-gradient(135deg, #fef9c3 0%, #fee2e2 40%, #f9fafb 100%)"
    : isNarrationSynthesize
    ? "linear-gradient(135deg, #0f172a 0%, #1d4ed8 32%, #f59e0b 70%, #fef3c7 100%)"
    : "linear-gradient(135deg, #eef2ff 0%, #eff6ff 40%, #f9fafb 100%)";

  // Taskset progress — use team-local counter so late-joining teams see "Task 1" for their first task
  const totalTasks =
    typeof tasksetTotalTasks === "number" && tasksetTotalTasks > 0 ? tasksetTotalTasks : null;

  const effectiveTaskNumber =
    typeof activeTestTaskIndex === "number"
      ? activeTestTaskIndex + 1
      : teamTaskNumber > 0
      ? teamTaskNumber
      : null;

  const clampedTaskNumber =
    effectiveTaskNumber && totalTasks
      ? Math.min(effectiveTaskNumber, totalTasks)
      : effectiveTaskNumber;

  const progressLabel =
    clampedTaskNumber && totalTasks
      ? `Task ${clampedTaskNumber} of ${totalTasks}`
      : clampedTaskNumber
      ? `Task ${clampedTaskNumber}`
      : null;
  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <ThemeModeContext.Provider value={themeMode}>
    <>
    {/* Animated theme background — rendered OUTSIDE the content div so z-index layering works */}
    {!isFlashcardsRace && !isMadDash && !isMindMapper && (
      <ThemeBackground theme={uiTheme} />
    )}
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100vh",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: isFlashcardsRace
          ? "radial-gradient(circle at top, #1e293b 0%, #0f172a 25%, #4f46e5 60%, #f97316 100%)"
          : isMadDash
          ? "radial-gradient(circle at top, #b91c1c 0%, #f97316 40%, #facc15 75%, #fee2e2 100%)"
          : isMindMapper
          ? "radial-gradient(circle at top, #0f172a 0%, #0ea5e9 40%, #22c55e 75%, #e0f2fe 100%)"
          : "transparent",
        color: themeShell.text,
        filter: `brightness(${uiBrightness})`,
        transition: "background 0.35s ease, color 0.25s ease, filter 0.18s ease",
      }}
    >
      <style>
        {`
        * {
          box-sizing: border-box;
        }

        .station-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          border: 1px solid rgba(15,23,42,0.25);
          background: rgba(255,255,255,0.85);
        }

        .station-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #e5e7eb;
        }

        .score-pill {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #fefce8;
          background: linear-gradient(135deg, #16a34a, #22c55e);
          box-shadow: 0 8px 18px rgba(22,163,74,0.35);
        }

        .score-pill span {
          margin-left: 4px;
        }

        .countdown-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          background: rgba(15,23,42,0.85);
          color: #f9fafb;
          border: 1px solid rgba(148,163,184,0.8);
        }

        .timer-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }
        .timer-dot.low-time {
          background: #f97316;
        }
        .timer-dot.critical {
          background: #ef4444;
        }

        .toast {
          position: fixed;
          left: 50%;
          bottom: 20px;
          transform: translateX(-50%);
          padding: 10px 16px;
          border-radius: 999px;
          font-size: 0.9rem;
          font-weight: 600;
          color: #111827;
          background: #fef9c3;
          border: 1px solid #facc15;
          box-shadow: 0 10px 25px rgba(15,23,42,0.4);
          z-index: 999;
        }

        .toast.negative {
          background: #fee2e2;
          border-color: #ef4444;
        }

        .pill-muted {
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15,23,42,0.08);
          color: #e5e7eb;
          font-size: 0.8rem;
        }

        .join-card {
          max-width: 480px;
          margin: 0 auto;
          padding: 20px 18px 18px 18px;
          border-radius: 24px;
          background: rgba(15,23,42,0.92);
          border: 1px solid rgba(148,163,184,0.7);
          box-shadow: 0 18px 45px rgba(15,23,42,0.9);
          color: #e5e7eb;
        }

        .join-card input {
          width: 100%;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.7);
          background: rgba(15,23,42,0.95);
          color: #f9fafb;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .join-card input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99,102,241,0.5);
        }

        .join-card button {
          width: 100%;
          padding: 9px 12px;
          border-radius: 999px;
          border: none;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          background: linear-gradient(135deg, #6366f1, #0ea5e9);
          color: #f9fafb;
          box-shadow: 0 10px 30px rgba(37,99,235,0.7);
          transition: transform 0.15s ease, box-shadow 0.15s ease,
            opacity 0.15s ease;
        }

        .join-card button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 12px 35px rgba(37,99,235,0.9);
        }

        .join-card button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        .join-card small {
          display: block;
          margin-top: 8px;
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .task-card {
          position: relative;
          overflow: hidden;
        }

        .task-card::before {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0.9;
          pointer-events: none;
        }

        .task-content-inner {
          position: relative;
          z-index: 1;
        }

        .noise-bar {
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(90deg, #22c55e, #facc15, #f97316, #ef4444);
          margin-top: 8px;
        }

        .noise-bar-track {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: rgba(15,23,42,0.25);
        }

        .noise-bar-inner {
          height: 100%;
          border-radius: 999px;
        }

        
        .noise-over {
          box-shadow: 0 0 0 2px rgba(239,68,68,0.35), 0 10px 28px rgba(239,68,68,0.18);
        }
        .noise-bar-hot {
          filter: saturate(1.35);
        }
        .noise-pulse {
          animation: noisePulse 0.65s ease-in-out 1;
        }
        @keyframes noisePulse {
          0% { transform: scaleY(1); }
          35% { transform: scaleY(1.35); }
          100% { transform: scaleY(1); }
        }
        @keyframes noiseWarnFade {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
.scan-error {
          color: #fee2e2;
          background: rgba(127,29,29,0.9);
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          margin-top: 6px;
          border: 1px solid rgba(248,113,113,0.9);
        }

        .location-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 500;
          background: rgba(15,23,42,0.85);
          color: #e5e7eb;
          border: 1px solid rgba(148,163,184,0.8);
        }

        .location-pill span {
          opacity: 0.9;
        }

        .location-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }

        .task-card input,
        .task-card textarea {
          font-family: inherit;
          color: #0f172a;
          border-radius: 10px;
          border: 1px solid #d1d5db;
          padding: 7px 9px;
          font-size: 0.95rem;
          outline: none;
          background: #ffffff;
          transition: border-color 0.15s ease, box-shadow 0.15s ease,
            background-color 0.15s ease;
        }

        .task-card input:focus,
        .task-card textarea:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(129,140,248,0.3);
          background-color: #f9fafb;
        }

        /* General button polish inside the task card */
        .task-card button {
          font-family: inherit;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 0.95rem;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: transform 0.1s ease, box-shadow 0.1s ease,
            opacity 0.1s ease;
          box-shadow: 0 4px 12px rgba(15,23,42,0.15);
        }

        .task-card button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(15,23,42,0.25);
        }

        .task-card button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* For BrainSparkNotes / MakeAndSnap etc, subtle bullet styling */
        .bullet-chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 0.8rem;
          background: rgba(15,23,42,0.06);
          margin: 0 4px 4px 0;
        }

        .bullet-chip span {
          opacity: 0.9;
        }

        /* AI feedback callout */
        .ai-feedback {
          margin-top: 10px;
          padding: 10px;
          border-radius: 12px;
          background: #eef2ff;
          border: 1px solid #c7d2fe;
          font-size: 0.85rem;
          color: #111827;
        }

        .ai-feedback strong {
          display: block;
          margin-bottom: 4px;
          font-size: 0.9rem;
        }

        /* NOISE SENSOR */
        .noise-fade {
          transition: opacity 0.3s ease, transform 0.3s ease;
        }

        /* TREAT BANNER */
        .treat-banner {
          position: fixed;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          padding: 8px 14px;
          border-radius: 999px;
          background: radial-gradient(circle at top, #22c55e, #15803d);
          color: #fefce8;
          font-size: 0.85rem;
          font-weight: 600;
          box-shadow: 0 15px 35px rgba(22,163,74,0.7);
          z-index: 999;
        }

        /* QR SCANNER SHELL */
        .scanner-shell {
          margin-top: 10px;
          border-radius: 18px;
          padding: 10px;
          background: rgba(15,23,42,0.9);
          border: 1px solid rgba(148,163,184,0.75);
          box-shadow: 0 15px 35px rgba(15,23,42,0.9);
        }

        /* TASK-LOCKED OVERLAY */
        .task-locked-overlay {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          color: #f9fafb;
          font-weight: 600;
          font-size: 0.95rem;
          z-index: 20;
          text-align: center;
          padding: 14px;
          background: transparent; /* ✅ no grey shading */
         }

        /* PROGRESS LINE */
        .progress-line {
          width: 100%;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.15);
          overflow: hidden;
          margin-top: 5px;
        }

        .progress-line-inner {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #ef4444, #f87171);
          transition: width 0.25s ease-out;
        }

        /* COUNTDOWN TIMER BAR */
        .countdown-bar-track {
          width: 100%;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.12);
          overflow: hidden;
          margin-top: 4px;
        }
        .countdown-bar-inner {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #f87171, #ef4444);
          transition: width 1s linear;
        }

        /* JEOPARDY / BRAINSTORM BATTLE STYLING */
        .jeopardy-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 10px;
        }

        .jeopardy-card {
          padding: 12px 10px;
          border-radius: 12px;
          background: rgba(15,23,42,0.9);
          border: 1px solid rgba(148,163,184,0.7);
          color: #fef9c3;
          font-size: 0.85rem;
          text-align: center;
          box-shadow: 0 10px 25px rgba(15,23,42,0.8);
        }

        .jeopardy-card strong {
          display: block;
          margin-bottom: 4px;
          font-size: 0.95rem;
        }

        .jeopardy-card button {
          margin-top: 6px;
          width: 100%;
          border-radius: 999px;
          padding: 6px 8px;
          background: linear-gradient(135deg, #22c55e, #0ea5e9);
          color: #f9fafb;
        }

        /* MIND MAPPER background hints */
        .mindmap-hint-chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(15,23,42,0.06);
          font-size: 0.8rem;
        }

        .mindmap-hint-chip span {
          opacity: 0.9;
        }

        /* BRAIN SPARK NOTES decorative */
        .spark-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(251,191,36,0.15);
          border: 1px solid rgba(245,158,11,0.9);
          font-size: 0.8rem;
          color: #92400e;
        }

        .spark-badge span {
          font-size: 1rem;
        }

        /* FLASHCARDS RACE indicator */
        .race-indicator {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15,23,42,0.85);
          color: #f9fafb;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .race-indicator-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
        }

        /* MYSTERY CLUES header animation */
        @keyframes mystery-glow {
          0% {
            text-shadow: 0 0 4px rgba(56,189,248,0.3);
          }
          50% {
            text-shadow: 0 0 12px rgba(56,189,248,0.9);
          }
          100% {
            text-shadow: 0 0 4px rgba(56,189,248,0.3);
          }
        }

        /* ECHO CHAIN header animation */
        @keyframes echo-glow {
          0% {
            text-shadow: 0 0 6px rgba(34,197,94,0.25), 0 0 2px rgba(14,165,233,0.18);
          }
          50% {
            text-shadow: 0 0 14px rgba(34,197,94,0.75), 0 0 10px rgba(14,165,233,0.55);
          }
          100% {
            text-shadow: 0 0 6px rgba(34,197,94,0.25), 0 0 2px rgba(14,165,233,0.18);
          }
        }

        /* EchoChain "pulse" overlay */
        @keyframes echo-pulse {
          0% { opacity: 0; transform: scale(0.98); }
          35% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.01); }
        }


        /* NARRATION SYNTHESIZE header animation */
        @keyframes narration-glow {
          0% {
            text-shadow: 0 0 6px rgba(245,158,11,0.22), 0 0 2px rgba(29,78,216,0.18);
          }
          50% {
            text-shadow: 0 0 16px rgba(245,158,11,0.78), 0 0 10px rgba(29,78,216,0.55);
          }
          100% {
            text-shadow: 0 0 6px rgba(245,158,11,0.22), 0 0 2px rgba(29,78,216,0.18);
          }
        }

        /* Narration sparkle overlay */
        @keyframes narration-spark {
          0% { opacity: 0; transform: scale(0.985); }
          30% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.01); }
        }

        /* HANGMAN header pulse */
        @keyframes hangman-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }

        /* MUSICAL CHAIRS header pulse */
        @keyframes mc-header-pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.04);
          }
        }


        @keyframes photo-flash {
          0% { opacity: 0; }
          20% { opacity: 0.55; }
          100% { opacity: 0; }
        }

        /* JEOPARDY lightning */
        @keyframes lightning-flash {
          0%, 100% {
            opacity: 0;
          }
          40% {
            opacity: 1;
          }
        }

        /* PET-HEALTH BAR */
        .pet-health-bar-wrapper {
          width: 100%;
          height: 14px;
          border-radius: 999px;
          background: rgba(15,23,42,0.15);
          overflow: hidden;
          border: 1px solid rgba(15,23,42,0.3);
        }

        .pet-health-bar-inner {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #ef4444, #f97316, #22c55e);
          transition: width 0.3s ease-out;
        }

        .pet-health-label {
          font-size: 0.8rem;
          font-weight: 500;
          color: #0f172a;
          margin-bottom: 2px;
        }

        /* DIFF-DETECTIVE RACE BANNER */
        .diff-race-banner {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(248,250,252,0.85);
          border: 1px solid rgba(148,163,184,0.9);
          font-size: 0.75rem;
          color: #0f172a;
        }

        .diff-race-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
        }

        .diff-race-dot.leader {
          background: #f97316;
        }

        .diff-race-dot.finished {
          background: #22c55e;
        }

        .diff-race-time {
          font-variant-numeric: tabular-nums;
        }

        /* CONFETTI LAYER FOR PERFECT SCORE */
        .confetti-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 900;
          background: radial-gradient(
            circle at top,
            rgba(250,250,250,0.4),
            transparent 60%
          );
        }

        .confetti-piece {
          position: absolute;
          width: 8px;
          height: 12px;
          border-radius: 2px;
        }

        .confetti-piece:nth-child(odd) {
          background: #f97316;
        }

        .confetti-piece:nth-child(even) {
          background: #22c55e;
        }
      `}
      </style>

      {/* HEADER */}
      {joined && (
        <AnimatedLeaderboard
          leaderboard={leaderboard}
          showConfetti={recentlyScoredBig} // Trigger on big points
          currentTeamName={yourTeamName}
        />
      )}
      {/* ── Sticky game-essentials banner ── */}
      {joined && postPhase === "tasks" && !tasksetComplete && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            background: "rgba(15,23,42,0.85)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderBottom: "1px solid rgba(148,163,184,0.2)",
            fontSize: "0.78rem",
            color: "#e2e8f0",
            gap: 8,
            flexWrap: "nowrap",
            minHeight: 32,
          }}
        >
          {/* Team selfie avatar + Team name + Station */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: "0 1 auto", overflow: "hidden" }}>
            {teamSelfieUrl && (
              <img
                src={teamSelfieUrl}
                alt=""
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  objectFit: "cover",
                  flexShrink: 0,
                  border: "1.5px solid rgba(255,255,255,0.3)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                }}
              />
            )}
            <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }}>{teamName || "Team"}</span>
            {stationInfo.color && (
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: stationInfo.color, flexShrink: 0 }} />
            )}
          </div>

          {/* Timer (task or review) */}
          <div style={{ flex: "0 0 auto" }}>
            {(() => {
              const inReview = taskLocked && postSubmitSecondsLeft != null;
              if (inReview) {
                const reviewMs = postSubmitSecondsLeft * 1000;
                return (
                  <span style={{ fontVariantNumeric: "tabular-nums", color: reviewMs <= 5000 ? "#f87171" : "#94a3b8" }}>
                    {formatRemainingMs(reviewMs)}
                  </span>
                );
              }
              if (timerDisplay) {
                return (
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: remainingMs <= 15000 ? "#f87171" : remainingMs <= 30000 ? "#fbbf24" : "#e2e8f0" }}>
                    {timerDisplay}
                  </span>
                );
              }
              return null;
            })()}
          </div>

          {/* Task progress (team-local counter) */}
          {effectiveTaskNumber && totalTasks && (
            <div style={{ flex: "0 0 auto", fontSize: "0.72rem", color: "#94a3b8" }}>
              {effectiveTaskNumber}/{totalTasks}
            </div>
          )}

          {/* Score */}
          <div style={{ flex: "0 0 auto", fontWeight: 800, color: "#fbbf24", whiteSpace: "nowrap" }}>
            <AnimatedScore value={scoreTotal} />
          </div>
        </div>
      )}

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 10,
        }}
      >
        <div>
          <header style={{ marginBottom: 4 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "1.4rem",
                color: "#ffffff",
              }}
            >
              Curriculate – Team Station
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "#4b5563",
              }}
            >
              Join your teacher&apos;s room, then scan stations as you move.
            </p>
          </header>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {joined && teamSelfieUrl && (
              <img
                src={teamSelfieUrl}
                alt="Team selfie"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "2px solid rgba(255,255,255,0.2)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                }}
              />
            )}
            {joined && (
              <span className="pill-muted">
                Team: <strong>{teamName || "…"}</strong>
              </span>
            )}
            {joined && (
              <span className="pill-muted">
                Room: <strong>{roomCode.toUpperCase()}</strong>
              </span>
            )}

            {stationInfo.id && (
              <span className="station-pill">
                <span
                  className="station-dot"
                  style={
                    stationInfo.color
                      ? { background: stationInfo.color }
                      : undefined
                  }
                />
                {stationInfo.label}
              </span>
            )}

            {roomLocation && (
              <span className="location-pill">
                <span className="location-dot" />
                <span>{roomLocation}</span>
              </span>
            )}

            {(() => {
              const inReview = taskLocked && postSubmitSecondsLeft != null;
              if (inReview) {
                const reviewMs = postSubmitSecondsLeft * 1000;
                return (
                  <span className="countdown-pill">
                    <span className={reviewMs <= 5000 ? "timer-dot critical" : "timer-dot"} />
                    {formatRemainingMs(reviewMs)}
                  </span>
                );
              }
              if (timerDisplay) {
                return (
                  <span className="countdown-pill">
                    <span className={remainingMs <= 15000 ? "timer-dot critical" : remainingMs <= 30000 ? "timer-dot low-time" : "timer-dot"} />
                    {timerDisplay}
                  </span>
                );
              }
              return null;
            })()}

            <span className="score-pill">
              <span role="img" aria-label="sparkles">
                ✨
              </span>
              <AnimatedScore value={scoreTotal} />
            </span>
          </div>
        </div>

        <div style={{ textAlign: "right", minWidth: 140 }}>
          {/* Taskset name — top right */}
          {roomState?.tasksetName && joined && (
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "#c4b5fd",
                marginBottom: 4,
                opacity: 0.9,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 180,
                marginLeft: "auto",
              }}
            >
              📚 {roomState.tasksetName}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 4,
              marginBottom: 4,
            }}
          >
            {Object.entries(THEMES).map(([key, t]) => (
              <button
                key={key}
                type="button"
                onClick={() => setUiTheme(key)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border:
                    uiTheme === key
                      ? `2px solid ${t.accent}`
                      : "1px solid rgba(148,163,184,0.5)",
                  background:
                    uiTheme === key
                      ? `${t.accent}33`
                      : "rgba(15,23,42,0.25)",
                  color: uiTheme === key ? t.accent : "#e5e7eb",
                  fontSize: "0.75rem",
                  fontWeight: uiTheme === key ? 700 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {joined && (
            <button
              type="button"
              onClick={handleJoinAnotherRoom}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.6)",
                background: "rgba(239,68,68,0.15)",
                color: "#fecaca",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Join another room
            </button>
          )}

          <div
            style={{
              fontSize: "0.75rem",
              color: connected ? "#bbf7d0" : "#fecaca",
            }}
          >
            {connected ? "Connected to server" : "Connecting…"}
          </div>
          {statusMessage && (
            <div
              style={{
                marginTop: 2,
                fontSize: "0.75rem",
                color: "#fee2e2",
              }}
            >
              {statusMessage}
            </div>
          )}
        </div>
      </header>

      {/* ── Offline / Reconnecting banner ── */}
      {!connected && joined && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
            color: "#fff",
            textAlign: "center",
            padding: "14px 16px",
            fontSize: "1.05rem",
            fontWeight: 700,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            animation: "offlinePulse 2s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: "1.3rem", marginRight: 8 }}>📡</span>
          Wi-Fi lost — reconnecting…
          <style>{`
            @keyframes offlinePulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
          `}</style>
        </div>
      )}

      {/* BUMPED SCREEN */}
      {bumped && !joined && (
        <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 32, maxWidth: 400,
            textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🚫</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#b91c1c", marginBottom: 8 }}>
              Removed from Session
            </div>
            <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: 20 }}>
              {bumped.reason}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
              Please see your teacher.
            </div>
          </div>
        </main>
      )}

      {/* JOIN CARD */}
      {!joined && !bumped && (
        <main style={{ flex: 1, display: "flex", alignItems: "flex-start" }}>
          <div className="join-card">
            <h2
              style={{
                marginTop: 0,
                marginBottom: 6,
                fontSize: "1.1rem",
              }}
            >
              Join the room
            </h2>
            <p
              style={{
                marginTop: 0,
                marginBottom: 12,
                fontSize: "0.85rem",
                color: "#9ca3af",
              }}
            >
              Enter the code shown on the board, pick a team name,
              and list your team members.
            </p>

            <form onSubmit={handleJoin}>
              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    marginBottom: 4,
                  }}
                >
                  Room Code
                </label>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="e.g. ABC123"
                  style={{ textTransform: "uppercase" }}
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    marginBottom: 4,
                  }}
                >
                  Team Name
                </label>
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(sanitizeName(e.target.value))}
                  placeholder="Your epic team name"
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 6,
                    fontSize: "0.78rem",
                    color: "#9ca3af",
                    cursor: "pointer",
                  }}
                  onClick={() => setWantStreak((v) => !v)}
                >
                  <input
                    type="checkbox"
                    checked={wantStreak}
                    onChange={() => {}}
                    style={{ accentColor: "#3b82f6", width: 16, height: 16, cursor: "pointer" }}
                  />
                  Earn streak points &amp; get personal reports
                </label>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    marginBottom: 4,
                  }}
                >
                  Team Members
                </label>
                {members.map((m, idx) => (
                  <div key={idx} style={{ marginBottom: wantStreak ? 8 : 4 }}>
                    <input
                      value={typeof m === "string" ? m : m?.name || ""}
                      onChange={(e) => {
                        const copy = [...members];
                        const cur = typeof copy[idx] === "string" ? { name: copy[idx], email: "" } : { ...copy[idx] };
                        cur.name = sanitizeName(e.target.value);
                        copy[idx] = cur;
                        setMembers(copy);
                      }}
                      placeholder={`Member ${idx + 1}`}
                    />
                    {wantStreak && (
                      <input
                        type="email"
                        value={typeof m === "string" ? "" : m?.email || ""}
                        onChange={(e) => {
                          const copy = [...members];
                          const cur = typeof copy[idx] === "string" ? { name: copy[idx], email: "" } : { ...copy[idx] };
                          cur.email = e.target.value;
                          copy[idx] = cur;
                          setMembers(copy);
                        }}
                        placeholder="email"
                        style={{
                          marginTop: 3,
                          fontSize: "0.78rem",
                          padding: "5px 8px",
                          color: "#6b7280",
                          background: "#f9fafb",
                          border: "1px solid #e5e7eb",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <button type="submit" disabled={!canJoin || joiningRoom}>
                {joiningRoom ? "Joining…" : "Join Room"}
              </button>

              <small>
                Tip: you can add more members later if your teacher allows.
              </small>
            </form>
          </div>
        </main>
      )}

      {/* MAIN TASK AREA */}
      {joined && (
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            marginTop: 8,
            gap: 8,
          }}
        >
          {/* Task progress + countdown timer bar */}
          {progressLabel && (
            <section style={{ marginBottom: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <div style={{ color: "#e5e7eb", fontWeight: 600, fontSize: "0.8rem" }}>{progressLabel}</div>
                {(() => {
                  const inReview = taskLocked && postSubmitSecondsLeft != null;
                  if (inReview) {
                    const reviewMs = postSubmitSecondsLeft * 1000;
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: reviewMs <= 5000 ? "#fca5a5" : "#4ade80", fontWeight: 700 }}>
                        <span className={reviewMs <= 5000 ? "timer-dot critical" : "timer-dot"} />
                        {formatRemainingMs(reviewMs)}
                      </div>
                    );
                  }
                  if (timerDisplay) {
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: remainingMs <= 15000 ? "#fca5a5" : remainingMs <= 30000 ? "#fcd34d" : "#e5e7eb", fontWeight: 700 }}>
                        <span className={remainingMs <= 15000 ? "timer-dot critical" : remainingMs <= 30000 ? "timer-dot low-time" : "timer-dot"} />
                        {timerDisplay}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              {effectiveTaskNumber && totalTasks && (
                <div className="progress-line">
                  <div
                    className="progress-line-inner"
                    style={{
                      width: `${Math.round((effectiveTaskNumber / totalTasks) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </section>
          )}

          {/* Noise/temperature bar */}
          <section>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#e5e7eb" }}>
                Classroom Noise
              </div>
              {noiseState.enabled && (
                <div style={{ fontSize: "0.75rem", color: "#e5e7eb" }}>
                  Target:{" "}
                  <span style={{ fontWeight: 600 }}>{noiseState.threshold}</span>
                </div>
              )}
            </div>
            <div className={`noise-bar-track noise-fade${noiseOver ? " noise-over" : ""}${noisePulse ? " noise-pulse" : ""}`}>
              <div
                className={`noise-bar-inner${noiseOver ? " noise-bar-hot" : ""}`}
                style={{
                  width: `${Math.min(Math.max(noiseState.level, 0), 100)}%`,
                  opacity: noiseBarOpacity,
                }}
              />
            </div>
            {/* Prominent noise warning banner when threshold exceeded */}
            {noiseOver && (
              <div style={{
                marginTop: 6,
                padding: "6px 12px",
                borderRadius: 10,
                background: "rgba(239,68,68,0.15)",
                border: "1px solid rgba(239,68,68,0.4)",
                color: "#fca5a5",
                fontSize: "0.8rem",
                fontWeight: 600,
                textAlign: "center",
                animation: "noiseWarnFade 1.5s ease-in-out infinite",
              }}>
                Too loud! Bring the volume down.
              </div>
            )}
          </section>

    {!tasksStarted && postPhase === "mood" && warmupStep === "mood" && !currentTask && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
        }}
      >
        <MoodCheckInTask
          socket={socket}
          roomCode={roomCode}
          teamId={teamId}
          memberNames={memberNames}
          onSubmit={(payload) => {
            // Ensure handleSubmitAnswer recognizes it as mood-checkin
            handleSubmitAnswer({ type: TASK_TYPES.MOOD_CHECKIN, ...payload })
          }}
        />
      </section>
    )}

    {/* ── Selfie step (between mood and treasure) ── */}
    {!tasksStarted && postPhase === "selfie" && warmupStep === "selfie" && !currentTask && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
        }}
      >
        <TeamSelfieTask
          task={{ config: { allowThemed: false } }}
          roomCode={roomCode}
          teamId={teamId}
          disabled={false}
          onSubmit={(payload) => {
            // Persist selfie URL (task sends photoUrl, not selfieUrl)
            const url = payload?.photoUrl || payload?.selfieUrl || "";
            if (url) {
              lsSet(LS_KEYS.selfieUrl, url);
            }
            // In mystery mode with room launched, skip treasure → go to grid
            if (isMysteryMode && roomIsActive) {
              setWarmupStep("done");
              lsSet(LS_KEYS.warmupDone, "1");
              tasksStartedRef.current = true;
              setPostPhase("tasks");
              socket.emit("mystery:requestGrid", {
                roomCode: roomCode.trim().toUpperCase(),
                teamId,
              });
              return;
            }
            // Advance to treasure
            setWarmupStep("treasure");
            setPostPhase("treasure");
          }}
        />
        <button
          type="button"
          onClick={() => {
            // In mystery mode with room launched, skip treasure → go to grid
            if (isMysteryMode && roomIsActive) {
              setWarmupStep("done");
              lsSet(LS_KEYS.warmupDone, "1");
              tasksStartedRef.current = true;
              setPostPhase("tasks");
              socket.emit("mystery:requestGrid", {
                roomCode: roomCode.trim().toUpperCase(),
                teamId,
              });
              return;
            }
            setWarmupStep("treasure");
            setPostPhase("treasure");
          }}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 0",
            border: "none",
            borderRadius: 12,
            background: "transparent",
            color: "#64748b",
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          Skip selfie
        </button>
      </section>
    )}

      {joined && testMode && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 16,
            background: "rgba(15,23,42,0.88)",
            border: "1px solid rgba(251,191,36,0.55)",
            color: "#f8fafc",
            boxShadow: "0 10px 25px rgba(15,23,42,0.22)",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            🧪 Test Mode
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              type="number"
              min="1"
              placeholder="Task #"
              value={testTaskInput}
              onChange={(e) => setTestTaskInput(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                width: 90,
              }}
            />

            <button
              type="button"
              onClick={() => {
                const oneBased = Number(testTaskInput);
                if (!Number.isInteger(oneBased) || oneBased <= 0) {
                  setStatusMessage("Enter a valid task number.");
                  return;
                }
                requestTestTaskByIndex(oneBased - 1);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "none",
                background: "#f59e0b",
                color: "#111827",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Load test task
            </button>

            <select
              value={
                typeof activeTestTaskIndex === "number"
                  ? String(activeTestTaskIndex)
                  : ""
              }
              onChange={handleTestTaskSelect}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                minWidth: 220,
              }}
            >
              <option value="">Select task…</option>
              {testTaskOptions.map((opt) => (
                <option key={opt.index} value={String(opt.index)}>
                  {opt.index + 1}. {opt.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={goToPrevTestTask}
              disabled={
                typeof activeTestTaskIndex === "number"
                  ? activeTestTaskIndex <= 0
                  : Number(testTaskInput || 1) <= 1
              }
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                opacity:
                  typeof activeTestTaskIndex === "number"
                    ? activeTestTaskIndex <= 0
                      ? 0.5
                      : 1
                    : Number(testTaskInput || 1) <= 1
                    ? 0.5
                    : 1,
              }}
            >
              ← Prev
            </button>

            <button
              type="button"
              onClick={goToNextTestTask}
              disabled={
                typeof totalTaskCount === "number" &&
                typeof activeTestTaskIndex === "number" &&
                activeTestTaskIndex >= totalTaskCount - 1
              }
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                opacity:
                  typeof totalTaskCount === "number" &&
                  typeof activeTestTaskIndex === "number" &&
                  activeTestTaskIndex >= totalTaskCount - 1
                    ? 0.5
                    : 1,
              }}
            >
              Next →
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                checked={testBypassScan}
                onChange={(e) => setTestBypassScan(e.target.checked)}
              />
              Bypass scan
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                checked={testLocalOnly}
                onChange={(e) => setTestLocalOnly(e.target.checked)}
              />
              Local-only submit
            </label>

            <button
              type="button"
              onClick={clearTestTaskMode}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Return to live flow
            </button>
          </div>

          {activeTestTaskIndex != null && (
            <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#fde68a" }}>
              Testing task {activeTestTaskIndex + 1}
            </div>
          )}
        </div>
      )}

    {joined && postPhase === "treasure" && (warmupStep === "treasure" || warmupStep === "done") && !currentTask && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
        }}
      >
        <TreasureRunner
          onSubmit={(payload) => {
            handleSubmitAnswer({ type: TASK_TYPES.TREASURE_RUNNER, ...payload })
            // After warmup pipeline, go to scan phase so student scans their station
            // before receiving tasks or seeing mystery boxes
            if (assignedColor && !scannedStationId) {
              setPostPhase("scan");
              setScannerActive(true);
            } else {
              setPostPhase("tasks");
            }
          }}
        />
        <div style={{ marginTop: 10, fontWeight: 700, opacity: 0.8, textAlign: "center" }}>
          Waiting for your first task…
        </div>
      </section>
    )}
          
{/* POST-TASK FEEDBACK (after last task, before trophy) */}
{postPhase === "feedback" && !tasksetComplete && (
  <section
    style={{
      marginTop: 12,
      padding: 16,
      borderRadius: 18,
      background: "rgba(255,255,255,0.92)",
      border: "1px solid rgba(15,23,42,0.12)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
    }}
  >
    <MultiPlayerFeedbackTask
      roomCode={roomCode}
      teamId={teamId}
      teamName={teamName}
      socket={socket}
      savedEmails={emails}
      onEmailsChange={(updated) => {
        setEmails(updated);
        try { lsSet(LS_KEYS.emails, JSON.stringify(updated)); } catch {}
      }}
      onSubmit={(payload) => {
        // send to server if it's listening
        try {
          socket.emit("feedback:submit", payload);
        } catch {}
        setPostPhase("trophy");
        setTasksetComplete(true);
        // Clear saved join data so shared tablets start fresh next session
        clearSavedJoin();
        // refresh scores for final trophy
        socket.emit("room:request-state", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
        });
      }}
    />
  </section>
)}

{/* TASKSET COMPLETE SCREEN */}
{tasksetComplete && (
  <section
    style={{
      marginTop: 12,
      padding: 16,
      borderRadius: 18,
      background: "rgba(255,255,255,0.92)",
      border: "1px solid rgba(15,23,42,0.12)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
      textAlign: "center",
    }}
  >
    {teamSelfieUrl && (
      <img
        src={teamSelfieUrl}
        alt="Team selfie"
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          objectFit: "cover",
          border: "3px solid #fbbf24",
          boxShadow: "0 4px 16px rgba(251,191,36,0.3)",
          margin: "0 auto 12px",
          display: "block",
        }}
      />
    )}
    <div style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: 6 }}>
      🎉 Victory!
    </div>
    <div style={{ fontSize: "1rem", opacity: 0.85, marginBottom: 12 }}>
      Task set complete — great work.
    </div>

    <div style={{ fontSize: "1.15rem", fontWeight: 800, marginBottom: 14 }}>
      Your Team: {teamName || "Team"} — <AnimatedScore value={typeof scoreTotal === "number" ? scoreTotal : 0} />
    </div>

    <AnimatedLeaderboard
      leaderboard={leaderboard}
      showConfetti={true}
      currentTeamName={teamName || null}
    />

    <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() =>
          socket.emit("room:request-state", {
            roomCode: roomCode.trim().toUpperCase(),
            teamId,
          })
        }
        className="border rounded-full px-4 py-2"
        style={{ background: "#0ea5e9", color: "#fff", fontWeight: 700 }}
      >
        Refresh scores
      </button>
      <button
        type="button"
        onClick={handleJoinAnotherRoom}
        className="border rounded-full px-4 py-2"
        style={{ background: "#111827", color: "#fff", fontWeight: 700 }}
      >
        Join another room
      </button>
    </div>

    {/* Share nudge — two options for different audiences */}
    <div
      style={{
        marginTop: 20,
        padding: "14px 18px",
        borderRadius: 16,
        background: "linear-gradient(135deg, #fdf2f8 0%, #eff6ff 100%)",
        border: "1px solid #e5e7eb",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 6 }}>
        🎉 Had fun? Share the experience!
      </div>
      <div style={{ fontSize: "0.82rem", color: "#4b5563", marginBottom: 10 }}>
        Curriculate works for classrooms, parties, and corporate events — interactive team games on any device.
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            const shareText = "I just played some awesome team games on Curriculate — it would be amazing for your classroom! Check it out: https://curriculate.net?ref=share";
            if (navigator.share) {
              navigator.share({ title: "Curriculate", text: shareText, url: "https://curriculate.net?ref=share" }).catch(() => {});
            } else {
              navigator.clipboard.writeText(shareText).then(() => {
                const btn = document.getElementById("share-teacher-btn");
                if (btn) { btn.textContent = "Copied! 🎉"; setTimeout(() => { btn.textContent = "Tell a Teacher"; }, 2000); }
              }).catch(() => {
                window.open("https://curriculate.net?ref=share", "_blank");
              });
            }
          }}
          id="share-teacher-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(135deg, #db2777, #7c3aed)",
            color: "#fff",
            fontWeight: 700,
            fontSize: "0.84rem",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(219,39,119,0.25)",
          }}
        >
          🎓 Tell a Teacher
        </button>
        <button
          type="button"
          onClick={() => {
            const shareText = "Just used Curriculate for an interactive team event — it was a hit. Would be great for your next offsite or conference: https://curriculate.net/events?ref=share";
            if (navigator.share) {
              navigator.share({ title: "Curriculate Events", text: shareText, url: "https://curriculate.net/events?ref=share" }).catch(() => {});
            } else {
              navigator.clipboard.writeText(shareText).then(() => {
                const btn = document.getElementById("share-events-btn");
                if (btn) { btn.textContent = "Copied! 🎉"; setTimeout(() => { btn.textContent = "Tell Your Team"; }, 2000); }
              }).catch(() => {
                window.open("https://curriculate.net/events?ref=share", "_blank");
              });
            }
          }}
          id="share-events-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(135deg, #2563eb, #4f46e5)",
            color: "#fff",
            fontWeight: 700,
            fontSize: "0.84rem",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(37,99,235,0.25)",
          }}
        >
          🏢 Tell Your Team
        </button>
      </div>
    </div>
  </section>
)}

{/* SCANNER PANEL (shows whenever scannerActive is true)
    Hidden for PMC — the camera is embedded inside the task's own scanner UI
    In mystery mode, hidden until a box is selected (currentTask is set) */}
{scannerActive &&
  !tasksetComplete &&
  !isPhysicalMultipleChoice &&
  postSubmitSecondsLeft == null &&
  !taskLocked &&
  !(isMysteryMode && !currentTask && scannedStationId) &&
  (
    mustScan ||
    currentTask?.taskType === TASK_TYPES.MAD_DASH ||
    currentTask?.taskType === TASK_TYPES.MAD_DASH_SEQUENCE
  ) && (
      <section
        style={{
          marginTop: 6,
          padding: 16,
          borderRadius: 18,
          background: (displayAssignedColor || stationInfo?.color || "black"),
          color: ((displayAssignedColor || stationInfo?.color) === "yellow") ? "#0f172a" : "#fff",
          border: "2px solid rgba(255,255,255,0.55)",
          textAlign: "center",
          boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        }}
      >
      <div style={{ fontSize: "1.35rem", fontWeight: 900, letterSpacing: 0.4 }}>
      {(() => {
        if (taskLocked) return null;

        const taskType = currentTask?.taskType;

        if (taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
          return "Scan the color of your answer";
        }

        if (
          taskType === TASK_TYPES.MAD_DASH ||
          taskType === TASK_TYPES.MAD_DASH_SEQUENCE
        ) {
          return "Scan the next color in the sequence";
        }

        const colorUpper = String(displayAssignedColor || stationInfo?.color || "").toUpperCase();
        const locationUpper = String(roomLocation || "").toUpperCase();

        if (!colorUpper) return "Scan station CurricQR code";

        if (isMultiRoom && enforceLocation && locationUpper) {
          return destinationText
            ? `Scan CurricQR Code at ${destinationText}`
            : "Scan station CurricQR code";
        }

        return `Scan CurricQR Code at ${colorUpper}`;
      })()}
    </div>

    <div style={{ fontSize: 14, opacity: 0.95, marginTop: 4 }}>
    {currentTask?.taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE
      ? "Choose A / B / C / D by scanning that option's station color."
      : currentTask?.taskType === TASK_TYPES.MAD_DASH ||
        currentTask?.taskType === TASK_TYPES.MAD_DASH_SEQUENCE
      ? "Scan only the next correct color."
      : "Get ready to Curriculate!"}
  </div>

  <div
    style={{
      marginTop: 12,
      background: "rgba(0,0,0,0.25)",
      borderRadius: 14,
      overflow: "hidden",
      border: "2px solid rgba(255,255,255,0.55)",
    }}
  >
    <section className="scanner-shell" style={{ textAlign: "center", margin: "24px 0" }}>
      <div style={{
        backgroundColor: displayAssignedColor || "#e5e7eb",
        borderRadius: 16,
        padding: 16,
        display: "inline-block",
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        maxWidth: "90vw",
      }}>
        {/* Always mount QrScanner to keep camera warm; toggle via active prop */}
          <div style={{ position: "relative", width: "100%" }}>
            <QrScanner
              active={scannerActive}
              onScan={(d) => { console.log("[QrScanner] onScan fired", d); return handleScan(d); }}
              onError={(e) => { console.log("[QrScanner] error", e); setScanError(e); }}
            />
          {waitingForLaunch && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 20,
                fontSize: 28,
                fontWeight: 800,
                color: "white",
                textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                pointerEvents: "none",
              }}
            >
              {waitingForLaunch && !tasksStartedRef.current && (
                <div>Waiting for Curriculate to Launch...</div>
              )}                      
            </div>
          )}
        </div>
        {scanError && (
          <div className="scan-error" style={{ marginTop: 12, color: "#ef4444", fontWeight: 600 }}>
            ⚠ {scanError}
          </div>
        )}
      </div>
    </section>
  </div>

  {scanStatus === "ok" && !currentTask && (
    <div style={{ marginTop: 10, fontWeight: 800 }}>
      ✅ Correct station — waiting for your next task…
    </div>
  )}
</section>
)}

{/* MILESTONE BONUS CARD (riddle/treat popup between mystery boxes) */}
{milestoneCard && (
  <div style={{
    position: "fixed", inset: 0, zIndex: 2000,
    background: "rgba(0,0,0,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20,
  }}>
    <div style={{
      maxWidth: 380, width: "100%",
      borderRadius: 24,
      overflow: "hidden",
      background: milestoneCard.type === "treat"
        ? "linear-gradient(135deg, #065f46, #047857)"
        : "linear-gradient(135deg, #1e1b4b, #312e81)",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      textAlign: "center",
      padding: "28px 24px",
      animation: "milestonePopIn 0.4s ease-out",
    }}>
      <style>{`
        @keyframes milestonePopIn {
          0% { transform: scale(0.6) rotate(-5deg); opacity: 0; }
          60% { transform: scale(1.05) rotate(1deg); }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
      `}</style>

      {milestoneCard.type === "riddle" && (
        <>
          <div style={{ fontSize: "3rem" }}>🧩</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#c4b5fd", marginTop: 8 }}>
            Riddle Break!
          </div>
          <div style={{
            marginTop: 16, fontSize: "1.1rem", fontWeight: 600, color: "#e2e8f0",
            lineHeight: 1.6, fontStyle: "italic",
          }}>
            "{milestoneCard.riddle}"
          </div>
          <div style={{
            marginTop: 16, fontSize: "1.2rem", fontWeight: 800, color: "#fbbf24",
            background: "rgba(251,191,36,0.15)", borderRadius: 12, padding: "10px 16px",
          }}>
            {milestoneCard.answer}
          </div>
        </>
      )}

      {milestoneCard.type === "treat" && (
        <>
          <div style={{ fontSize: "3rem" }}>🎁</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#6ee7b7", marginTop: 8 }}>
            Treat Time!
          </div>
          <div style={{
            marginTop: 12, fontSize: "1.1rem", fontWeight: 600, color: "#d1fae5",
            lineHeight: 1.5,
          }}>
            Your team earned a treat!
            <br />See your teacher to claim it.
          </div>
        </>
      )}

      <div style={{
        marginTop: 8, fontSize: "0.75rem", color: "rgba(255,255,255,0.5)",
      }}>
        {milestoneCard.completedCount} of {milestoneCard.totalBoxes} boxes done
      </div>

      <button
        onClick={() => setMilestoneCard(null)}
        style={{
          marginTop: 18, padding: "12px 32px",
          borderRadius: 999, border: "none",
          background: milestoneCard.type === "treat" ? "#10b981" : "#8b5cf6",
          color: "#fff", fontWeight: 800, fontSize: "1rem",
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}
      >
        {milestoneCard.type === "treat" ? "Awesome!" : "Back to boxes!"}
      </button>
    </div>
  </div>
)}

{/* MYSTERY BOX GRID (when in mystery mode and no active task, only after initial scan) */}
{joined && postPhase === "tasks" && isMysteryMode && mysteryBoxGrid && !currentTask && !tasksetComplete && (
  <section style={{ marginTop: 10 }}>
    <MysteryBoxGrid
      grid={mysteryBoxGrid}
      onOpenBox={(boxPos) => {
        // In mystery mode: let the box open and task get assigned first.
        // The scan requirement kicks in AFTER assignment — the task UI
        // won't render until they scan (gated by mustScan in the task
        // rendering condition). This gives the flow: Grid → Pick → Scan → Task.
        console.log("[mystery] opening box", boxPos, "teamId", teamId);
        socket.emit("mystery:openBox", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          boxPos,
        }, (ack) => {
          console.log("[mystery] openBox ack:", ack);
          if (ack && !ack.ok) {
            // Server rejected — likely stale activeBox. Request fresh grid.
            console.warn("[mystery] openBox rejected:", ack.error, "— requesting fresh grid");
            socket.emit("mystery:requestGrid", {
              roomCode: roomCode.trim().toUpperCase(),
              teamId,
            });
          }
        });
      }}
      challengeBeacon={challengeBeacon}
      onAcceptChallenge={(challengeId) => {
        socket.emit("mystery:acceptChallenge", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          challengeId,
        });
        setChallengeBeacon(null);
      }}
      teamName={teamName}
    />
  </section>
)}

{/* "Scan first" popup */}
{scanFirstPopup && (
  <div
    onClick={() => setScanFirstPopup(false)}
    style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.45)",
    }}
  >
    <div style={{
      background: "#fff",
      borderRadius: 20,
      padding: "28px 24px",
      maxWidth: 320,
      textAlign: "center",
      boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: "#1e293b", marginBottom: 6 }}>
        Scan your station first!
      </div>
      <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.4 }}>
        Point your camera at the CurricQR code on your station before opening a mystery box.
      </div>
    </div>
  </div>
)}

{/* TASK CARD (only when not gated) */}
{joined && postPhase === "tasks" && !currentTask && (!mustScan || taskLocked || taskNeedsGlobalScanner) && !tasksetComplete && waitingForLaunch && !isMysteryMode && (
  <section
    style={{
      marginTop: 10,
      padding: 16,
      borderRadius: 18,
      background: "rgba(15,23,42,0.25)", //was 0.9
      border: "1px solid rgba(148,163,184,0.75)",
      color: "#f9fafb",
      textAlign: "center",
      boxShadow: "0 16px 40px rgba(15,23,42,0.95)",
    }}
  >
    <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>Getting your first activity ready…</div>
    <div style={{ marginTop: 6, opacity: 0.9 }}>
      If this takes more than a few seconds, rescan or ask your teacher.
    </div>
  </section>
)}

{joined && postPhase === "tasks" && !!currentTask && (!mustScan || taskLocked || taskNeedsGlobalScanner) && !tasksetComplete && (
  <section
    className="task-card"
    style={{
      ...baseTaskCardStyle,
      ...(isMotionMission || isPetFeeding || isRecordAudio || isJeopardy
        ? { background: "transparent", padding: 0, border: "none", boxShadow: "none" }
        : { background: taskCardBackground }),
    }}
  >
    <h2
      style={{
        marginTop: 0,
        marginBottom: 6,
        fontSize: responseHeadingFontSize,
        letterSpacing: 0.2,
        color: "#0f172a",
        ...(musicalChairsHeaderStyle || {}),
        ...(mysteryHeaderStyle || {}),
        ...(hangmanHeaderStyle || {}),
        ...(echoHeaderStyle || {}),
        ...(narrationHeaderStyle || {}),
      }}
    >
      {/* Progress label now shown above noise bar; removed duplicate here */}
      {currentTask.title || currentTask.name || "Task"}
    </h2>
    {/* Countdown bar: shows during the answer/review overlay, below the title */}
    {(() => {
      const reviewTotal = typeof reviewState?.secondsLeft === "number"
        ? reviewState.secondsLeft
        : DEFAULT_POST_SUBMIT_SECONDS;
      const inReview = taskLocked && postSubmitSecondsLeft != null && reviewTotal > 0;

      if (inReview) {
        const pct = Math.max(0, Math.min(100, (postSubmitSecondsLeft / reviewTotal) * 100));
        return (
          <div className="countdown-bar-track" style={{ marginBottom: 8 }}>
            <div
              className="countdown-bar-inner"
              style={{
                width: `${pct}%`,
                background: reviewState?.accepted
                  ? "linear-gradient(90deg, #22c55e, #4ade80)"
                  : "linear-gradient(90deg, #f59e0b, #fbbf24)",
                transition: "width 0.9s linear",
              }}
            />
          </div>
        );
      }
      return null;
    })()}
    <div
      className="task-content-inner"
      style={{
        position: "relative",
        fontSize: responseFontSize,
        lineHeight: 1.5,
        minHeight: isMotionMission || isPetFeeding ? "60vh" : undefined,
      }}
    >
      {debugMode && (
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={debugForceEndTaskNow}
          style={{
            background: "rgba(15,23,42,0.85)",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 999,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          🧪 Debug: Skip / Next
        </button>
      </div>
    )}
      {echoPulse && isEchoChain && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 20% 10%, rgba(34,197,94,0.18), transparent 55%), radial-gradient(circle at 80% 0%, rgba(14,165,233,0.14), transparent 60%), radial-gradient(circle at 50% 90%, rgba(168,85,247,0.10), transparent 60%)",
            animation: "echo-pulse 1.2s ease-out 1",
          }}
        />
      )}

      {scriptSpotlight && isScriptPlay && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 50% 20%, rgba(250,204,21,0.20), transparent 55%), radial-gradient(circle at 20% 80%, rgba(59,130,246,0.18), transparent 60%), radial-gradient(circle at 80% 80%, rgba(236,72,153,0.14), transparent 62%)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
            animation: "echo-pulse 1.4s ease-out 1",
          }}
        />
      )}

      {narrationSpark && isNarrationSynthesize && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 20% 20%, rgba(245,158,11,0.20), transparent 55%), radial-gradient(circle at 80% 15%, rgba(29,78,216,0.18), transparent 60%), radial-gradient(circle at 50% 90%, rgba(56,189,248,0.10), transparent 60%)",
            animation: "narration-spark 1.05s ease-out both",
          }}
        />
      )}

      {rolePlayGlow && isRolePlayDeck && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 30% 30%, rgba(34,197,94,0.16), transparent 55%), radial-gradient(circle at 70% 25%, rgba(59,130,246,0.16), transparent 55%), radial-gradient(circle at 50% 85%, rgba(168,85,247,0.14), transparent 58%)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
            animation: "echo-pulse 1.4s ease-out 1",
          }}
        />
      )}

      {wordWeaverGlow && isWordWeaver && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 25% 15%, rgba(34,197,94,0.18), transparent 55%), radial-gradient(circle at 80% 35%, rgba(59,130,246,0.14), transparent 60%), radial-gradient(circle at 50% 92%, rgba(245,158,11,0.10), transparent 60%)",
            animation: "echo-pulse 1.25s ease-out 1",
          }}
        />
      )}
      {vennGlow && isVennSort && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 20% 20%, rgba(34,197,94,0.16), transparent 55%), radial-gradient(circle at 80% 20%, rgba(14,165,233,0.14), transparent 60%), radial-gradient(circle at 50% 90%, rgba(245,158,11,0.10), transparent 60%)",
            animation: "echo-pulse 1.25s ease-out 1",
          }}
        />
      )}

      {readingGlow && isReadingComp && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 20% 30%, rgba(56,189,248,0.16), transparent 55%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.14), transparent 60%)",
            animation: "narration-spark 1.05s ease-out both",
          }}
        />
      )}

      {sketchSpark && isSpeedDraw && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 15% 25%, rgba(96,165,250,0.18), transparent 60%), radial-gradient(circle at 80% 15%, rgba(168,85,247,0.14), transparent 62%), radial-gradient(circle at 55% 92%, rgba(249,115,22,0.10), transparent 60%)",
            animation: "narration-spark 1.05s ease-out both",
          }}
        />
      )}

      {photoFlash && (isPhoto || isPhotoJournal) && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "linear-gradient(0deg, rgba(255,255,255,0.0), rgba(255,255,255,0.0))",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset",
            animation: "photo-flash 420ms ease-out 1",
          }}
        />
      )}

      {huntPulse && isHideNSeek && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 30% 30%, rgba(14,165,233,0.18), transparent 55%), radial-gradient(circle at 70% 25%, rgba(34,197,94,0.14), transparent 55%), radial-gradient(circle at 50% 85%, rgba(250,204,21,0.10), transparent 60%)",
            animation: "echo-pulse 1.35s ease-out 1",
          }}
        />
      )}

      {fakeOutFlash && isFakeOut && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 30% 25%, rgba(251,191,36,0.22), transparent 55%), radial-gradient(circle at 70% 60%, rgba(59,130,246,0.16), transparent 58%), radial-gradient(circle at 55% 95%, rgba(236,72,153,0.12), transparent 60%)",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.08) inset, 0 18px 60px rgba(0,0,0,0.35)",
            animation: "echo-pulse 1.1s ease-out 1",
          }}
        />
      )}

      {debateGlow && isAIDebateJudge && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 18,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 20% 25%, rgba(14,165,233,0.18), transparent 58%), radial-gradient(circle at 80% 20%, rgba(250,204,21,0.16), transparent 60%), radial-gradient(circle at 50% 92%, rgba(236,72,153,0.10), transparent 60%)",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.08) inset, 0 18px 60px rgba(0,0,0,0.30)",
            animation: "echo-pulse 1.35s ease-out 1",
          }}
        />
      )}

      <TaskErrorBoundary onError={(err) => setTaskRenderError(err)} fallback={
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={endReviewAndReturnToScan}
            className="border rounded-full px-4 py-2"
            style={{ background: "#111827", color: "#fff", fontWeight: 700 }}
          >
            Back to scan
          </button>
        </div>
      }>
      <TaskRunner
        key={
          currentTask?.id ??
          currentTask?._id ??
          currentTaskIndex ??
          currentTask?.prompt ??
          "task"
        }
        task={themedTask}
        taskIndex={currentTaskIndex}
        taskTypes={TASK_TYPES}
        scannerSlot={
          isPhysicalMultipleChoice && scannerActive
            ? <QrScanner
                onScan={(d) => { console.log("[QrScanner/PMC] onScan fired", d); return handleScan(d); }}
                onError={(e) => { console.log("[QrScanner/PMC] error", e); setScanError(e); }}
              />
            : null
        }
        onSubmit={handleSubmitAnswer}
        submitting={submitting}
        onAnswerChange={setCurrentAnswerDraft}
        answerDraft={currentAnswerDraft}
        disabled={taskLocked || submitting}
        review={taskLocked ? reviewState : null}
        mode={taskLocked ? "review" : "play"}
        socket={socket}
        roomCode={roomCode}
        playerTeam={{ id: teamId, teamName }}
        memberNames={memberNames}
        savedEmails={emails}
        onEmailsChange={setEmails}
        remainingMs={remainingMs}
        partnerAnswer={partnerAnswer}
        showPartnerReply={showPartnerReply}
        onPartnerReply={(replyText) => {
        if (!roomCode || !joined || !currentTask || teamId == null) return;

        socket.emit("collab:reply", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          taskIndex:
            typeof currentTaskIndex === "number" && currentTaskIndex >= 0
              ? currentTaskIndex
              : null,
          reply: replyText,
        });
        }}
      />
      </TaskErrorBoundary>
    </div>

    {submitting &&
      (currentTask?.taskType === TASK_TYPES.SHORT_ANSWER ||
        currentTask?.taskType === TASK_TYPES.READING_COMP) && (
        <div
          style={{
            marginTop: 12,
            width: "100%",
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 12,
            padding: 16,
            textAlign: "center",
            fontWeight: 800,
          }}
        >
          Wait for it...
        </div>
    )}

    {/* ── Short-answer / open-text / record-audio / reading-comp inline feedback (no overlay) ──
         Reading-comp is included here so the reader-rotation feedback panel shows after submit. ── */}
    {taskLocked && !isPhysicalTask &&
     (currentTask?.taskType === TASK_TYPES.SHORT_ANSWER ||
      currentTask?.taskType === TASK_TYPES.OPEN_TEXT ||
      currentTask?.taskType === TASK_TYPES.RECORD_AUDIO ||
      currentTask?.taskType === TASK_TYPES.READING_COMP) &&
     reviewState && (
      <div style={{ marginTop: 12, width: "100%", borderRadius: 14, overflow: "hidden" }}>
        {/* Thin countdown bar at top */}
        {postSubmitSecondsLeft != null && (() => {
          const lockTotal = typeof reviewState?.secondsLeft === "number"
            ? reviewState.secondsLeft
            : DEFAULT_POST_SUBMIT_SECONDS;
          return (
            <div style={{ height: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <style>{`@keyframes shrinkBarSA { from { width:100%; } to { width:0%; } }`}</style>
              <div style={{
                height: "100%",
                background: (currentTask?.taskType === TASK_TYPES.RECORD_AUDIO || reviewState?.accepted)
                  ? "rgba(74,222,128,0.8)"
                  : "rgba(239,68,68,0.7)",
                animation: `shrinkBarSA ${lockTotal}s linear forwards`,
              }} />
            </div>
          );
        })()}
        {/* Feedback body */}
        {(() => {
          const isRecordAudio = currentTask?.taskType === TASK_TYPES.RECORD_AUDIO;
          const showGreen = isRecordAudio || reviewState?.accepted;
          return (
        <div style={{
          padding: "12px 14px",
          background: showGreen ? "rgba(20,83,45,0.92)" : "rgba(30,15,15,0.88)",
          border: showGreen
            ? "1px solid rgba(74,222,128,0.45)"
            : "1px solid rgba(239,68,68,0.45)",
          borderTop: "none",
          color: "#fff",
          fontSize: "0.9rem",
          lineHeight: 1.5,
          display: "grid",
          gap: 6,
        }}>
          {/* accepted / not-accepted badge — varies by task type */}
          <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>
            {currentTask?.taskType === TASK_TYPES.RECORD_AUDIO
              ? (reviewState?.transcript ? "🎙️ Recording analysed" : "✅ Recording submitted")
              : currentTask?.taskType === TASK_TYPES.OPEN_TEXT
                ? (reviewState?.accepted ? "✅ Accepted" : "📝 Reviewed")
                : (reviewState?.accepted ? "✅ Accepted" : "💪 Not quite — keep it up!")}
          </div>
          {/* Transcript of spoken response (record-audio only) */}
          {currentTask?.taskType === TASK_TYPES.RECORD_AUDIO && reviewState?.transcript && (
            <div style={{
              fontSize: "0.82rem",
              background: "rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "6px 10px",
              fontStyle: "italic",
              color: "rgba(255,255,255,0.85)",
            }}>
              <span style={{ fontWeight: 700, fontStyle: "normal" }}>What you said: </span>
              "{reviewState.transcript.length > 200
                ? reviewState.transcript.slice(0, 197) + "…"
                : reviewState.transcript}"
            </div>
          )}
          {reviewState?.feedback && (() => {
            const reader = reviewState.reader || null;
            return (
              <>
                {reader && (
                  <div style={{
                    fontSize: "0.82rem", fontWeight: 700,
                    background: "rgba(255,255,255,0.12)", borderRadius: 8,
                    padding: "4px 10px", marginBottom: 2,
                  }}>
                    📢 {reader}, read the feedback below aloud to your team.
                  </div>
                )}
                <div>
                  {currentTask?.taskType === TASK_TYPES.RECORD_AUDIO
                    ? reviewState.feedback
                    : <><span style={{ fontWeight: 700 }}>Feedback: </span>{reviewState.feedback}</>}
                </div>
              </>
            );
          })()}
          {reviewState?.hint && (
            <div>
              <span style={{ fontWeight: 700 }}>Next step: </span>
              {reviewState.hint}
            </div>
          )}
          {reviewState?.modelAnswer && (
            <div style={{ opacity: 0.85, fontStyle: "italic" }}>
              <span style={{ fontWeight: 700, fontStyle: "normal" }}>Example: </span>
              {reviewState.modelAnswer}
            </div>
          )}
          {!reviewState?.feedback && !reviewState?.hint && !reviewState?.modelAnswer && reviewState?.comment && (
            <div>{reviewState.comment}</div>
          )}
          {/* "Read it" button — only appears AFTER countdown expires */}
          {postSubmitSecondsLeft != null && postSubmitSecondsLeft <= 0 && (() => {
            // Re-use the reader already stored in reviewState (stable)
            const readerName = reviewState?.reader || null;
            return (
              <button
                type="button"
                onClick={() => endReviewAndReturnToScan()}
                style={{
                  marginTop: 6,
                  padding: "10px 24px",
                  borderRadius: 999,
                  border: "2px solid rgba(255,255,255,0.5)",
                  background: "rgba(255,255,255,0.25)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  backdropFilter: "blur(4px)",
                  alignSelf: "center",
                  animation: "matchPopIn 0.3s ease-out",
                }}
              >
                {readerName ? `${readerName} read it` : "I read it"} →
              </button>
            );
          })()}
        </div>
          );
        })()}
      </div>
    )}

    {taskLocked && !isPhysicalTask && !taskRunnerOwnsReview && (
      <div className="task-locked-overlay">
        <style>{`
          @keyframes matchPopIn {
            from { transform: translateY(6px) scale(0.98); opacity: 0; }
            to   { transform: translateY(0px) scale(1); opacity: 1; }
          }
          @keyframes processingPulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
          @keyframes indeterminateBar {
            0% { left: -40%; width: 40%; }
            50% { left: 30%; width: 40%; }
            100% { left: 100%; width: 40%; }
          }
        `}</style>

        {/* Processing indicator — shown while waiting for server response */}
        {submitting && postSubmitSecondsLeft == null && !reviewState && (
          <div style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "24px 16px",
            minHeight: 120,
          }}>
            {/* Indeterminate progress bar */}
            <div style={{
              width: "100%",
              height: 3,
              borderRadius: 999,
              background: "rgba(255,255,255,0.18)",
              overflow: "hidden",
              position: "relative",
            }}>
              <div style={{
                position: "absolute",
                height: "100%",
                background: "rgba(255,255,255,0.85)",
                borderRadius: 999,
                animation: "indeterminateBar 1.5s ease-in-out infinite",
              }} />
            </div>
            <div style={{
              animation: "processingPulse 2s ease-in-out infinite",
              fontSize: "1rem",
              fontWeight: 700,
            }}>
              Processing your answer…
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              This may take a moment
            </div>
          </div>
        )}

        {postSubmitSecondsLeft != null && (() => {
          // Determine total lock duration safely for progress bar
          const lockTotal =
            typeof reviewState?.secondsLeft === "number"
              ? reviewState.secondsLeft
              : (typeof postSubmitSecondsLeft === "number"
                  ? postSubmitSecondsLeft
                  : DEFAULT_POST_SUBMIT_SECONDS);

          const isCatchingUp = reviewState?.isCatchingUp === true;
          const hasPacingHold = reviewState?.pacingHold === true;

          // Compute the next task's designated handler for the handoff prompt.
          // Uses simple index-based round-robin matching DesignatedWriter.
          const activeNames = Array.isArray(memberNames) ? memberNames.filter((n) => n && n.trim()) : [];
          const nextIdx = typeof currentTaskIndex === "number" ? currentTaskIndex + 1 : 0;
          const nextHandlerName = activeNames.length > 1
            ? activeNames[nextIdx % activeNames.length]
            : null;

          return (
            <div style={{ width: "100%", position: "relative", minHeight: 120 }}>
              <style>{`
                @keyframes shrinkBar {
                  from { width: 100%; }
                  to   { width: 0%; }
                }
                @keyframes handoffPulse {
                  0%, 100% { transform: scale(1); }
                  50% { transform: scale(1.03); }
                }
              `}</style>
              {/* Countdown bar removed from the overlay — the yellow/green
                 countdown-bar-track below the h2 title already shows this. */}
            {/* centered message with optional catch-up badge */}
            <div
              style={{
                marginTop: 18,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingTop: 18,
              }}
            >
              {isCatchingUp && (
                <div
                  style={{
                    display: "inline-block",
                    background: "rgba(59, 130, 246, 0.3)",
                    border: "1px solid rgba(59, 130, 246, 0.6)",
                    color: "rgba(255, 255, 255, 0.9)",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Catching up...
                </div>
              )}
              <div>
                {hasPacingHold
                  ? reviewState?.pacingMessage || "Waiting for other teams..."
                  : "Review your answer…"}
              </div>
              <div
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontSize: "1.2rem",
                  fontWeight: 800,
                }}
              >
                {postSubmitSecondsLeft}s
              </div>

              {/* Handoff prompt — pass the device to the next player */}
              {nextHandlerName && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 20px",
                    borderRadius: 16,
                    background: "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(59,130,246,0.3))",
                    border: "1px solid rgba(139,92,246,0.5)",
                    textAlign: "center",
                    animation: "handoffPulse 2s ease-in-out infinite",
                  }}
                >
                  <div style={{ fontSize: "1.6rem", marginBottom: 4 }}>👋</div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>
                    Hand the device to
                  </div>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#e0e7ff", marginTop: 2 }}>
                    {nextHandlerName}
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })()}
          {/* Matching answer reveal removed — MatchingTask already colours
               connect lines green/red inline, so the overlay was redundant. */}

          {/* ✅ Objective answer key + per-item correctness overlay
               Skip MC & TF — TaskRunner already highlights correct/incorrect in review mode */}
          {isObjectiveTask(currentTask) &&
           currentTask?.taskType !== "matching" &&
           currentTask?.taskType !== "sort" &&
           currentTask?.taskType !== "vennsort" &&
           currentTask?.taskType !== "multiple-choice" &&
           currentTask?.taskType !== "true-false" && (() => {
            const task = currentTask;
            const taskType = task?.taskType || task?.type;
            const submission = reviewState?.studentAnswer;
            const key = buildObjectiveAnswerKey(task);
            if (!key) return null;

            // Helper: extract student's answer for item at index idx
            const getStudentAnswerText = (item, idx, opts) => {
              if (!submission) return null;
              const answers = Array.isArray(submission?.answers) ? submission.answers : null;
              const raw = answers ? (answers[idx]?.value ?? answers[idx]?.answer ?? answers[idx]) : (submission?.answer ?? null);
              if (raw == null) return null;
              if (typeof raw === "number" && Array.isArray(opts) && opts[raw] != null) return String(opts[raw]);
              return String(raw);
            };

            const isItemCorrect = (item, idx, opts) => {
              const studentText = getStudentAnswerText(item, idx, opts);
              if (studentText == null) return null; // not answered
              const c = item?.correctAnswer;
              if (c == null) return null;
              if (taskType === TASK_TYPES.TRUE_FALSE) {
                const sn = String(studentText).trim().toLowerCase();
                const cn = tfCorrectToText(c).toLowerCase();
                return sn === cn || sn === String(c).trim().toLowerCase();
              }
              if (typeof c === "number" && Array.isArray(opts) && opts[c] != null) {
                const correctText = String(opts[c]).trim().toLowerCase();
                const sn = String(studentText).trim().toLowerCase();
                return sn === correctText || Number(studentText) === c;
              }
              return String(studentText).trim().toLowerCase() === String(c).trim().toLowerCase();
            };

            const panelStyle = {
              marginTop: 12,
              width: "100%",
              background: "rgba(255,255,255,0.97)",
              border: "1px solid rgba(0,0,0,0.10)",
              borderRadius: 12,
              padding: 14,
              textAlign: "left",
              color: "#0f172a",
            };

            // ── MC / TF / SA: per-item coloured cards ──
            if (key.rows) {
              const items = Array.isArray(task.items) ? task.items : [];
              return (
                <div style={panelStyle}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>{key.title || "Answer key"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {key.rows.map((r, i) => {
                      const item = items[i] || {};
                      const opts = Array.isArray(item.options)
                        ? item.options
                        : Array.isArray(task.options)
                        ? task.options
                        : (taskType === TASK_TYPES.TRUE_FALSE ? ["True", "False"] : []);
                      const studentText = getStudentAnswerText(item, i, opts);
                      const ok = isItemCorrect(item, i, opts);
                      const borderColor =
                        ok === true ? "rgba(34,197,94,0.7)"
                        : ok === false ? "rgba(239,68,68,0.7)"
                        : "rgba(255,255,255,0.2)";
                      const bgColor =
                        ok === true ? "rgba(34,197,94,0.18)"
                        : ok === false ? "rgba(239,68,68,0.18)"
                        : "rgba(0,0,0,0.12)";
                      const icon = ok === true ? "✅" : ok === false ? "❌" : "⬜";
                      return (
                        <div key={i} style={{ padding: 10, borderRadius: 10, background: bgColor, border: `1px solid ${borderColor}`, display: "grid", gap: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 700, flex: 1 }}>{r.q}</div>
                            <div style={{ fontSize: "1.1rem" }}>{icon}</div>
                          </div>
                          <div style={{ opacity: 0.92, fontSize: "0.92rem" }}>
                            <span style={{ opacity: 0.75 }}>Correct: </span>
                            <strong>{r.a}</strong>
                          </div>
                          {studentText != null && ok === false && (
                            <div style={{ opacity: 0.85, fontSize: "0.88rem" }}>
                              <span style={{ opacity: 0.75 }}>You answered: </span>
                              <span style={{ fontWeight: 700 }}>{studentText}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // ── SEQUENCE / TIMELINE: numbered list ──
            if (key.ordered) {
              return (
                <div style={panelStyle}>
                  <div style={{ fontWeight: 800, marginBottom: 8, color: "#0f172a" }}>{key.title || "Correct order"}</div>
                  <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                    {key.ordered.map((it) => (
                      <li key={it.n} style={{ marginBottom: 4, lineHeight: 1.4, color: "#1e293b" }}>
                        {it.text}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            }

            // ── SORT: bucket groups ──
            if (key.buckets) {
              return (
                <div style={panelStyle}>
                  <div style={{ fontWeight: 800, marginBottom: 8, color: "#0f172a" }}>{key.title || "Correct categories"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {key.buckets.map((b, idx) => (
                      <div key={idx} style={{ padding: 10, borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
                        <div style={{ fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>{b.bucket}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {(b.items || []).map((txt, j) => (
                            <span key={j} style={{ padding: "4px 10px", borderRadius: 999, background: "#ffffff", border: "1px solid #cbd5e1", color: "#1e293b", fontWeight: 600 }}>
                              {txt}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {Array.isArray(key.unassigned) && key.unassigned.length > 0 && (
                      <div style={{ marginTop: 6, opacity: 0.9, fontSize: "0.9rem" }}>
                        Unassigned: <strong>{key.unassigned.join(", ")}</strong>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return null;
          })()}

          </div>
        )}
        </section>
      )}
    {/* Must scan gate (message only; scanner itself is already above when scannerActive) */}
    {joined && currentTask && hardMustScan && (
      <section
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 18,
          background: "rgba(15,23,42,0.9)",
          border: "1px solid rgba(248,250,252,0.8)",
          color: "#fefce8",
          textAlign: "center",
          boxShadow: "0 16px 40px rgba(15,23,42,0.95)",
        }}
      >
        <div style={{ fontSize: "1rem", fontWeight: 700 }}>
          🚪 Scan the correct station first
        </div>
        <p style={{ marginTop: 6, fontSize: "0.9rem", marginBottom: 0 }}>
          Your teacher has locked this task to a specific station. Scan the station's
          CurricQR code to unlock it.
        </p>
      </section>
      )}
    </main>
    )}

    {/* TREAT BANNER */}
    {treatMessage && <div className="treat-banner">{treatMessage}</div>}

    {/* POINT TOAST */}
    {pointToast && (
      <div
        className={`toast ${pointToast.positive ? "" : "negative"}`}
        style={{
          position: "fixed",
          top: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          padding: "10px 22px",
          borderRadius: 14,
          fontWeight: 800,
          fontSize: pointToast.positive ? "1.3rem" : "1rem",
          color: "#fff",
          background: pointToast.positive
            ? "linear-gradient(135deg, #10b981, #059669)"
            : "linear-gradient(135deg, #ef4444, #dc2626)",
          boxShadow: pointToast.positive
            ? "0 4px 20px rgba(16,185,129,0.4)"
            : "0 4px 20px rgba(239,68,68,0.4)",
          animation: "toastSlideIn 0.3s ease-out",
          textAlign: "center",
          minWidth: 120,
        }}
      >
        {pointToast.message}
      </div>
    )}

    {/* NOISE SENSOR — invisible; captures mic samples and emits to backend */}
    {roomCode && noiseState.enabled && (
      <NoiseSensor
        active={noiseState.enabled}
        roomCode={roomCode.trim().toUpperCase()}
        socket={socket}
      />
    )}

    {/* CONFETTI LAYER */}
    {showConfetti && (
      <div className="confetti-layer">
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            className="confetti-piece"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 40}%`,
              transform: `rotate(${Math.random() * 45}deg)`,
            }}
          />
        ))}
      </div>
    )}

    {/* STUDENT FEEDBACK BUTTON — always visible */}
    <FeedbackButton
      roomCode={roomCode}
      teamName={teamName}
      members={members}
      tasksetName={roomState?.tasksetName}
      currentTask={currentTask}
      currentTaskIndex={currentTaskIndex}
      totalTasks={tasksetTotalTasks}
    />

    {/* FOOTER STRIP */}
    <div style={{
      position: "fixed",
      bottom: 4,
      right: 8,
      fontSize: 10,
      opacity: 0.6,
      color: "#fff",
      textShadow: "0 0 3px rgba(0,0,0,0.8)",
      zIndex: 9999,
    }}>
      v{BUILD_MARKER}
    </div>
    <div
      style={{
        marginTop: 16,
        height: "50vh",
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        backgroundColor: displayAssignedColor
          ? displayAssignedColor
          : stationInfo?.color
          ? stationInfo.color
          : "#e5e7eb",
        boxShadow: "0 -4px 12px rgba(15,23,42,0.25)",
      }}
    />
  </div>
  </>
  </ThemeModeContext.Provider>
  );
}

export default StudentApp;
