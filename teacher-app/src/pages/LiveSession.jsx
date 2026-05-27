// teacher-app/src/pages/LiveSession.jsx
import React, { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { socket } from "../socket";
import { fetchMyProfile } from "../api/profile";
import {
  TASK_TYPES,
  TASK_TYPE_META,
  QUICK_TASK_ELIGIBLE_TYPES,
} from "../../../shared/taskTypes.js";
import { API_BASE_URL } from "../config";
import { useAuth } from "../auth/useAuth";
import SpotlightTour, { TourHelpButton, resetTour } from "../components/SpotlightTour";

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

// Quick AI task types we actually support in LiveSession
// Note: "Competitive" is a category (not a taskType). Quick Launch types must be real task types.
// We always include GUESS_WHO here because it is a single-screen, intra-team deduction game
// that works well as an ad-hoc quick task.
const QUICK_TASK_TYPES_RAW =
  QUICK_TASK_ELIGIBLE_TYPES && QUICK_TASK_ELIGIBLE_TYPES.length
    ? QUICK_TASK_ELIGIBLE_TYPES
    : [
        TASK_TYPES.MULTIPLE_CHOICE,
        TASK_TYPES.TRUE_FALSE,
        TASK_TYPES.SHORT_ANSWER,
        TASK_TYPES.OPEN_TEXT,
        TASK_TYPES.ECHO_CHAIN,
        TASK_TYPES.NARRATION_SYNTHESIZE,
      ];

const QUICK_TASK_TYPES = Array.from(
  new Set([
    ...QUICK_TASK_TYPES_RAW,
    // Ensure GuessWho is selectable even if QUICK_TASK_ELIGIBLE_TYPES isn't updated yet.
    TASK_TYPES.GUESS_WHO,
    // Ensure Flashcards + Flashcards Race are selectable even if shared meta is stale.
    (TASK_TYPES.FLASHCARDS || "flashcards"),
    (TASK_TYPES.FLASHCARDS_RACE || "flashcards-race"),
    (TASK_TYPES.FAKE_OUT || "fake-out"),
    (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck"),
    (TASK_TYPES.WORD_WEAVER_DUEL || "word-weaver-duel"),
    (TASK_TYPES.MAD_DASH_SEQUENCE || "mad-dash-sequence"),
    (TASK_TYPES.MAD_DASH || "mad-dash"),
    (TASK_TYPES.VENNSORT || "vennsort"),
    (TASK_TYPES.SPEED_DRAW || "speed-draw"),
    (TASK_TYPES.DRAW_MIME || "draw-mime"),
    (TASK_TYPES.PHYSICAL_MYSTERY_CLUES || "physical-mystery-clues"),
    (TASK_TYPES.DIFF_DETECTIVE || "diff-detective"),

    (TASK_TYPES.MATCHING || "matching"),
    (TASK_TYPES.SEQUENCE || "sequence"),
    (TASK_TYPES.SORT || "sort"),
    (TASK_TYPES.TIMELINE || "timeline"),
    (TASK_TYPES.VENNSORT || "vennsort"),
    (TASK_TYPES.SPEED_DRAW || "speed-draw"),
    (TASK_TYPES.PHOTO_JOURNAL || "photo-journal"),
    (TASK_TYPES.PHOTO || "photo"),
    (TASK_TYPES.HIDENSEEK || "hidenseek"),
    (TASK_TYPES.TRUE_FALSE_TICTACTOE || "true-false-tictactoe"),
    (TASK_TYPES.MULTI_PLAYER_FEEDBACK || "multi-player-feedback"),
    (TASK_TYPES.PRONUNCIATION || "pronunciation"),
    (TASK_TYPES.RECORD_AUDIO || "record-audio"),
    (TASK_TYPES.SPEECH_RECOGNITION || "speech-recognition"),
    (TASK_TYPES.BRAIN_BLITZ || "brainblitz"),
    (TASK_TYPES.HANGMAN_DUEL || "hangman-duel"),
    (TASK_TYPES.MOOD_CHECKIN || "mood-checkin"),
    (TASK_TYPES.BRAINSTORM_BATTLE || "brainstorm-battle"),
    (TASK_TYPES.COLLABORATION || "collaboration"),
    (TASK_TYPES.LIVE_DEBATE || "live-debate"),
    (TASK_TYPES.PET_FEEDING || "pet-feeding"),
    (TASK_TYPES.AI_DEBATE_JUDGE || "ai-debate-judge"),

    // Reading comprehension (intra-team, AI-scored): paragraph + 1-sentence response
    (TASK_TYPES.READING_COMP || "reading-comp"),

  ].filter((t) => t && t !== TASK_TYPES.SCRIPT_PLAY && t !== 'script-play'))
);




// Objective solo quick-launch types we want fully supported in LiveSession
const QUICK_OBJECTIVE_SOLO_TYPES = new Set([
  TASK_TYPES.MATCHING || "matching",
  TASK_TYPES.SEQUENCE || "sequence",
  TASK_TYPES.SORT || "sort",
  TASK_TYPES.TIMELINE || "timeline",
]);

function isOneOfObjectiveSolo(type) {
  return QUICK_OBJECTIVE_SOLO_TYPES.has(type);
}
const PURPOSE_OPTIONS = [
  "Introduction",
  "Review",
  "Reflection",
  "Enrichment",
  "Assessment",
];

// --- RolePlay Deck parsing helpers ---
function parseRolePlayRolesText(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const roles = [];
  for (const line of lines) {
    // Accept separators: |, —, -, ;  (prefer 3 parts: name, role, traits)
    // Examples:
    //  - Alex | Governor | fair, cautious, decisive
    //  - Marie — Merchant — persuasive, curious, generous
    //  - "Priest: Shepherd | humble, bold, kind" (still works decently)
    const parts = line.split(/\s*(\||—|–|-|;|:)\s*/).filter((p) => p && !/^(\||—|–|-|;|:)$/.test(p));
    let name = "";
    let role = "";
    let traits = "";

    if (parts.length >= 3) {
      name = parts[0];
      role = parts[1];
      traits = parts.slice(2).join(" ");
    } else if (parts.length === 2) {
      name = parts[0];
      role = parts[1];
    } else {
      // Fallback: treat entire line as role name
      role = parts[0] || line;
    }

    const characteristics = String(traits || "")
      .split(/[,/]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 7);

    roles.push({
      name: String(name || "").trim() || "Player",
      role: String(role || "").trim() || String(line || "").trim(),
      characteristics,
    });
  }

  // Filter empty
  return roles
    .map((r) => ({
      name: String(r.name || "").trim() || "Player",
      role: String(r.role || "").trim(),
      characteristics: Array.isArray(r.characteristics) ? r.characteristics : [],
    }))
    .filter((r) => r.role);
}

function buildRolePlayQuickConfig({ mode, scenario, rolesText }) {
  const roles = parseRolePlayRolesText(rolesText);
  const scenarioStr = String(scenario || "").trim();
  const prompt =
    scenarioStr ||
    "Draw roles and role-play the scenario together. Stay respectful and on-topic.";
  return {
    prompt,
    timeLimitSeconds: 180,
    config: {
      mode: mode || "choose",
      scenario: scenarioStr,
      roles,
    },
    // meta flags used in other parts of LiveSession
    intraTeamEnabled: true,
    interTeamEnabled: false,
    objectiveScoring: false,
    aiScoringRequired: false,
  };
}

const PHOTO_TASK_TYPES = new Set([
  "photo-task",
  "photojournal",
  "photo-journal",
  "photo",
  "photoJournal",
  "PhotoTask",
  "PhotoJournal",
]);

function pickPhotoUrl(sub) {
  return (
    sub?.photoUrl ||
    sub?.imageUrl ||
    sub?.fileUrl ||
    sub?.mediaUrl ||
    sub?.data?.photoUrl ||
    sub?.data?.imageUrl ||
    sub?.data?.fileUrl ||
    sub?.data?.mediaUrl ||
    (Array.isArray(sub?.photos) ? sub.photos[0] : null) ||
    (Array.isArray(sub?.data?.photos) ? sub.data.photos[0] : null) ||
    null
  );
}

function buildLatestPhotoByTeam(submissions = []) {
  const out = {}; // teamId -> { url, at }
  for (const s of submissions) {
    const tt = (s?.taskType || s?.task?.taskType || "").toString();
    if (!PHOTO_TASK_TYPES.has(tt)) continue;

    const url = pickPhotoUrl(s);
    if (!url) continue;

    const at = new Date(s?.submittedAt || s?.createdAt || 0).getTime();
    if (!out[s.teamId] || at > out[s.teamId].at) {
      out[s.teamId] = { url, at };
    }
  }
  return out;
}


function summarizeNarrationSubmission(sub) {
  // Supports various shapes: sub.ratings, sub.data.ratings, sub.data.peerRatings
  const ratings =
    (Array.isArray(sub?.ratings) ? sub.ratings : null) ||
    (Array.isArray(sub?.data?.ratings) ? sub.data.ratings : null) ||
    (Array.isArray(sub?.data?.peerRatings) ? sub.data.peerRatings : null) ||
    null;

  if (!ratings || ratings.length === 0) return null;

  const nums = ratings
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  if (nums.length === 0) return null;

  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = sum / nums.length;

  // Determine scale if present
  const scale =
    sub?.ratingScale ||
    sub?.data?.ratingScale ||
    sub?.task?.config?.ratingScale ||
    sub?.taskConfig?.ratingScale ||
    null;

  const max =
    scale && Number(scale.max) > 0 ? Number(scale.max) :
    // common default
    5;

  return {
    avg,
    count: nums.length,
    max,
  };
}

function stationIdToColor(id) {
  const m = /^station-(\d+)$/.exec(id || "");
  const idx = m ? parseInt(m[1], 10) - 1 : -1;
  return idx >= 0 ? COLORS[idx] || null : null;
}

export function isObjectiveScoringTaskType(taskType) {
  const meta = TASK_TYPE_META[taskType];
  return !!meta?.objectiveScoring;
}

export default function LiveSession({ roomCode: roomCodeProp }) {
  const [status, setStatus] = useState("Checking connection…");
  const { user } = useAuth();

  const location = useLocation();
  const qs = new URLSearchParams(location.search || "");
  const roomFromQuery = (qs.get("room") || "").trim().toUpperCase();
  const sharedToken = (qs.get("sharedToken") || qs.get("token") || "").trim();
  const reportOwnerId = (qs.get("reportOwnerId") || "").trim();
  const reportOwnerName = (qs.get("reportOwnerName") || qs.get("from") || "").trim();
  const reportOwnerEmail = (qs.get("reportOwnerEmail") || "").trim();

  const roomCode = roomFromQuery || (roomCodeProp || "").trim().toUpperCase();

  const runByName =
    (user && (user.name || user.fullName || user.displayName)) ||
    (user && user.email) ||
    "Presenter";

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
    // NEW: mood check-ins (no scoring)
    moodCheckins: {},
  });

  const [submissions, setSubmissions] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);
  const [teamOrder, setTeamOrder] = useState([]);

  const [isLaunchingQuick, setIsLaunchingQuick] = useState(false);
  const [quickStatus, setQuickStatus] = useState("");
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [teacherRooms, setTeacherRooms] = useState([]);
  const [navigationMode, setNavigationMode] = useState("linear"); // "linear" | "mystery"
  const [mysteryTimerMinutes, setMysteryTimerMinutes] = useState(30);

  // Per-session "on-screen only" mode.  Drops every task that
  // requires students to leave their seat (musical-chairs, mad-dash,
  // mad-dash-sequence, physical-multiple-choice, hidenseek,
  // treasure-runner).  Curriculate's design principle is that
  // students get up and around the room — but the platform has
  // plenty of substantive tasks that work just as well at the desk,
  // so teachers can switch to a desks/iPads-only mode for a
  // particular lesson without losing the rest of the catalogue.
  const [onScreenOnly, setOnScreenOnly] = useState(false);

  // Per-session duels toggle. Duels are a runtime trigger (not baked-in
  // content), so the teacher opts in per session here at launch.
  const [duelsEnabled, setDuelsEnabled] = useState(false);

  // Plan tier — read once from /api/profile/me so we can hide PLUS-only UI
  // (class linking) and PRO-only UI from FREE-tier teachers without making
  // them hit a 403 from the server.
  const [planTier, setPlanTier] = useState("FREE");
  const planTierRank = (t) => (t === "PRO" ? 2 : t === "PLUS" ? 1 : 0);
  const isAtLeastPlus = planTierRank(planTier) >= 1;

  // Class rosters (Mode B): teacher's uploaded class lists, used to bind
  // a session to a specific class so the join screen can offer a name
  // dropdown and the report CSV gets Edsby Student IDs auto-filled.
  const [classRosters, setClassRosters] = useState([]); // [{id, className, studentCount, students}]
  const [selectedClassRosterId, setSelectedClassRosterId] = useState(() => {
    // Mode B (sub): if a sub teacher launched via a class-bound share link,
    // the binding rides through localStorage. Pre-fill it so it propagates
    // to teacher:loadTaskset without the sub touching anything.
    try {
      return localStorage.getItem("curriculateSharedClassRosterId") || "";
    } catch {
      return "";
    }
  });
  // Read-only display name for sub flow (sub doesn't own the roster)
  const sharedClassName = (() => {
    try {
      return localStorage.getItem("curriculateSharedClassName") || "";
    } catch {
      return "";
    }
  })();
  const isSharedClassBoundLaunch = !!sharedClassName && !!selectedClassRosterId;

  // NEW dynamic system — only these
  const [taskType, setTaskType] = useState(
    QUICK_TASK_TYPES[0] || TASK_TYPES.SHORT_ANSWER
  );
  const [taskConfig, setTaskConfig] = useState({});
  const [showAiGen, setShowAiGen] = useState(false);

  const [aiGrade, setAiGrade] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [aiPurpose, setAiPurpose] = useState("");
  const [aiSubject, setAiSubject] = useState("");
  const [aiWordList, setAiWordList] = useState("");
  const [quickFlashcardsText, setQuickFlashcardsText] = useState("");
  // RolePlay Deck quick-entry fields
  const [rolePlayMode, setRolePlayMode] = useState("choose"); // choose | mystery | classic
  const [rolePlayScenarioText, setRolePlayScenarioText] = useState("");
  const [rolePlayRolesText, setRolePlayRolesText] = useState("");

  // Quick AI task / error state
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState(null);

  // Keep track of the most recently launched quick task
  const [lastQuickTask, setLastQuickTask] = useState(null);

// Keep quick-launch config in sync for RolePlay Deck when teacher edits fields (no JSON needed)
useEffect(() => {
  const isRolePlay =
    taskType === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck") ||
    taskType === "role-play-deck" ||
    taskType === TASK_TYPES.ROLE_PLAY ||
    taskType === "role-play" ||
    taskType === "roleplay";

    const isDiffDetective = taskType === (TASK_TYPES.DIFF_DETECTIVE || "diff-detective") || taskType === "diff-detective";
    const isVennSort = taskType === (TASK_TYPES.VENNSORT || "vennsort") || taskType === "vennsort";
    const isSpeedDraw = taskType === (TASK_TYPES.SPEED_DRAW || "speed-draw") || taskType === "speed-draw";
    const isDrawMime = taskType === (TASK_TYPES.DRAW_MIME || "draw-mime") || taskType === "draw-mime";
    const isPhysicalMysteryClues = taskType === (TASK_TYPES.PHYSICAL_MYSTERY_CLUES || "physical-mystery-clues") || taskType === "physical-mystery-clues";

  if (!isRolePlay) return;

  const built = buildRolePlayQuickConfig({
    mode: rolePlayMode,
    scenario: rolePlayScenarioText,
    rolesText: rolePlayRolesText,
  });

  setTaskConfig((prev) => {
    // Avoid unnecessary rerenders if nothing changed materially
    const prevRoles = Array.isArray(prev?.config?.roles) ? prev.config.roles : [];
    const nextRoles = Array.isArray(built?.config?.roles) ? built.config.roles : [];
    const prevScenario = String(prev?.config?.scenario || "").trim();
    const nextScenario = String(built?.config?.scenario || "").trim();
    const prevMode = String(prev?.config?.mode || "choose");
    const nextMode = String(built?.config?.mode || "choose");

    if (
      prevScenario === nextScenario &&
      prevMode === nextMode &&
      prevRoles.length === nextRoles.length &&
      String(prev?.prompt || "") === String(built?.prompt || "")
    ) {
      return prev;
    }

    return {
      ...(prev || {}),
      prompt: built.prompt,
      timeLimitSeconds: built.timeLimitSeconds,
      config: {
        ...(prev?.config || {}),
        mode: built.config.mode,
        scenario: built.config.scenario,
        roles: built.config.roles,
      },
      intraTeamEnabled: true,
      interTeamEnabled: false,
      objectiveScoring: false,
      aiScoringRequired: false,
    };
  });
}, [taskType, rolePlayMode, rolePlayScenarioText, rolePlayRolesText]);


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

  // When the active taskset is one that was generated with the at-desk-only
  // toggle, flip the per-session "On-screen only" checkbox on by default.
  // The teacher can still uncheck it for that one session if they want.
  useEffect(() => {
    if (activeTasksetMeta?.atDeskOnly === true) {
      setOnScreenOnly(true);
    }
  }, [activeTasksetMeta?.atDeskOnly]);

  // When true, we have requested a taskset launch and are waiting for
  // "tasksetLoaded" before calling teacher:launchNextTask.
  const [launchAfterLoad, setLaunchAfterLoad] = useState(false);

  // Auto-start configuration for pre-armed launches
  const [autoStartMode, setAutoStartMode] = useState("immediate"); // "immediate" | "first_ready" | "all_ready" | "timer"
  const [autoStartTimerMinutes, setAutoStartTimerMinutes] = useState(3);
  const [autoStartMinTeams, setAutoStartMinTeams] = useState(4);
  const [tasksetArmed, setTasksetArmed] = useState(false); // true when taskset is loaded but waiting for trigger

  // Taskset launch progress (for the "Generate/Launch Taskset" green-fill button effect)
  const [tasksetLaunchProgress, setTasksetLaunchProgress] = useState(0); // 0..100
  const [tasksetLaunchAnimating, setTasksetLaunchAnimating] = useState(false);

  const activeTasksetName = (
    activeTasksetMeta?.name ||
    activeTasksetMeta?.title ||
    activeTasksetMeta?.tasksetName ||
    "Untitled set"
  ).replace(/^taskset:\s*/i, "").trim();

  const totalTasksInActiveSet =
    (Array.isArray(activeTasksetMeta?.tasks) &&
      activeTasksetMeta.tasks.length) ||
    (typeof activeTasksetMeta?.taskCount === "number" &&
    activeTasksetMeta.taskCount > 0
      ? activeTasksetMeta.taskCount
      : null) ||
    (Array.isArray(activeTasksetMeta?.taskList) &&
      activeTasksetMeta.taskList.length) ||
    // Fallback: use totalTasks from room state (sent by backend buildRoomState)
    (typeof roomState?.totalTasks === "number" && roomState.totalTasks > 0
      ? roomState.totalTasks
      : null) ||
    null;

  const isFixedStationTaskset =
    !!activeTasksetMeta?.isFixedStationTaskset ||
    activeTasksetMeta?.deliveryMode === "fixed-stations" ||
    activeTasksetMeta?.mode === "fixed-stations";

  // Room setup / fixed-station helper
  const [roomSetup, setRoomSetup] = useState(null);
  const [showRoomSetup, setShowRoomSetup] = useState(false);

  // Pruning of old rooms
  const teacherInstanceIdRef = useRef(null);
  if (teacherInstanceIdRef.current == null) {
    try {
      const key = "curriculate.teacherInstanceId";
      let id = localStorage.getItem(key);

      if (!id) {
        id =
          (typeof crypto !== "undefined" && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(key, id);
      }

      teacherInstanceIdRef.current = id;
    } catch {
      teacherInstanceIdRef.current = `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

    // Socket connection tracking for offline banner
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

    // End-session / email reports logic
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [endSessionMessage, setEndSessionMessage] = useState("");
  const [endSessionIsError, setEndSessionIsError] = useState(false);
  const [includeIndividualReports, setIncludeIndividualReports] = useState(false);
  const [teacherAssessmentCategories, setTeacherAssessmentCategories] = useState([]);
  const autoEndFiredRef = React.useRef(false);
  const [reportProgress, setReportProgress] = useState(null); // { step, total, label }
  const [savedReportId, setSavedReportId] = useState(null);

  // When a task is force-advanced, pause between tasks so teacher can "Launch" next
  const [taskAdvancedPause, setTaskAdvancedPause] = useState(false);

  // Behavior ding popup state
  const [dingPopup, setDingPopup] = useState(null); // { teamId, teamName } or null
  const [dingReason, setDingReason] = useState("");
  const DING_AMOUNT = 10; // points per ding

  // Join & treat sounds
  const joinSoundRef = useRef(null);
  const treatSoundRef = useRef(null);

  // Noise-control local UI state (defaults: enabled, light mode threshold=30)
  // Persist to localStorage so it's sticky across sessions
  const [noiseLevel, setNoiseLevel] = useState(0);
  const [noiseThreshold, setNoiseThreshold] = useState(() => {
    try { const v = localStorage.getItem("curriculate.teacher.noiseThreshold"); return v != null ? Number(v) : 30; } catch { return 30; }
  });
  const [noiseEnabled, setNoiseEnabled] = useState(() => {
    try { const v = localStorage.getItem("curriculate.teacher.noiseEnabled"); return v != null ? v === "true" : true; } catch { return true; }
  });
  const [noiseBrightness, setNoiseBrightness] = useState(1);

  // Treats UI state (mirrors roomState.treatsConfig — seeded from profile on room create)
  const [treatsConfig, setTreatsConfig] = useState({ enabled: true, total: 2, given: 0 });
  // Track which teams already got a treat this session (never same group twice)
  const [treatedTeamIds, setTreatedTeamIds] = useState(new Set());

  // Location override (multi-room presets from Presenter Profile)
  const [locationOptions, setLocationOptions] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);

  // Hide & Seek launch-time clues
  const [hideNSeekTasks, setHideNSeekTasks] = useState([]);
  const [hideNSeekClues, setHideNSeekClues] = useState({});
  const [showHideNSeekModal, setShowHideNSeekModal] = useState(false);
  const [pendingHideTaskset, setPendingHideTaskset] = useState(null);
  const [launchingTaskset, setLaunchingTaskset] = useState(false);

  // Fixed-station setup checklist
  const [showLiveTour, setShowLiveTour] = useState(false);

  const [showStationChecklist, setShowStationChecklist] = useState(false);
  const [stationChecklistDisplays, setStationChecklistDisplays] = useState([]);
  const [stationChecklistChecked, setStationChecklistChecked] = useState({});
  const [pendingStationTaskset, setPendingStationTaskset] = useState(null);

  const [reviewPauseSeconds, setReviewPauseSeconds] = useState(30);

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

  // Load this teacher's class rosters (Mode B class binding)
  useEffect(() => {
    const teacherEmail = (user?.email || reportOwnerEmail || "").trim();
    if (!teacherEmail) {
      setClassRosters([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/class-roster/list?teacherEmail=${encodeURIComponent(teacherEmail)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const rosters = Array.isArray(data?.rosters) ? data.rosters : [];
        setClassRosters(rosters);
      } catch (e) {
        console.warn("[LiveSession] class roster fetch failed:", e?.message || e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, reportOwnerEmail]);

  useEffect(() => {
    async function loadTeacherRooms() {
      const profile = await fetchMyProfile();
      const include =
        typeof profile?.includeIndividualReports === "boolean"
          ? profile.includeIndividualReports
          : !!profile?.includeStudentReports;

      setIncludeIndividualReports(include);
      setTeacherAssessmentCategories(profile.assessmentCategories || []);

      setTeacherRooms(profile.locationOptions || []);
      setLocationOptions(profile.locationOptions || []);

      // Tier (PLUS = class-linking, PRO = trend reports)
      if (profile?.planTier) setPlanTier(String(profile.planTier).toUpperCase());
    }
    loadTeacherRooms();
  }, []);

  useEffect(() => {
    if (!socket || !roomCode) return;
    const t = setInterval(() => {
      socket.emit("teacher:keepalive", {
        roomCode,
        teacherInstanceId: teacherInstanceIdRef.current,
      });
    }, 5000);
    return () => clearInterval(t);
  }, [roomCode]);

  // ----------------------------------------------------
  // Ensure room exists + re-assert on reconnect
  // ----------------------------------------------------
  useEffect(() => {
  if (!roomCode) return;

  const code = roomCode.toUpperCase();

  const ensureRoom = () => {
    try {
      const sharedFromTeacherId = localStorage.getItem("curriculateSharedFromTeacherId");
      const sharedFromTeacherEmail = localStorage.getItem("curriculateSharedFromTeacherEmail");

      socket.emit("teacher:createRoom", {
        roomCode: code,
        teacherInstanceId: teacherInstanceIdRef.current,
        ...(sharedFromTeacherId && { sharedFromTeacherId }),
        ...(sharedFromTeacherEmail && { sharedFromTeacherEmail }),
      });
      setStatus("Connected.");
    } catch (err) {
      // no-op
    }
  };

  // Run once (covers initial mount if already connected) + on every reconnect
  if (socket.connected) ensureRoom();
  socket.on("connect", ensureRoom);

  return () => {
    socket.off("connect", ensureRoom);
  };
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
        submissions: Array.isArray(state.submissions) ? state.submissions : (prev.submissions || []),
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
        // NEW: mood check-ins (no scoring)
        moodCheckins: state.moodCheckins || prev.moodCheckins || {},
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

      // Sync location options from room state (covers reconnect scenarios)
      if (Array.isArray(state.locationOptions) && state.locationOptions.length > 0) {
        setLocationOptions((prev) => prev.length > 0 ? prev : state.locationOptions);
        setTeacherRooms((prev) => prev.length > 0 ? prev : state.locationOptions);
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

        setTasksetLaunchProgress(92);

        socket.emit("teacher:launchNextTask", {
          roomCode: code,
          selectedRooms,
        });

        // Smoothly fill to 100% and then reset
        setTimeout(() => {
          setTasksetLaunchProgress(100);
          setTimeout(() => {
            setTasksetLaunchAnimating(false);
            setTasksetLaunchProgress(0);
          }, 650);
        }, 250);
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
        setEndSessionIsError(false);
      } else {
        // Report was likely saved even if email failed — include a link
        const reportId = payload.reportId;
        const viewLink = reportId ? ` <a href="/reports" style="color:#2563eb;text-decoration:underline">View your saved report →</a>` : "";
        setEndSessionMessage(
          (payload.error || "There was a problem emailing the reports.") +
          (reportId ? " Your report data was saved successfully." : "") +
          viewLink
        );
        setEndSessionIsError(true);
        if (reportId) setSavedReportId(reportId);
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
      // Track which team got treated (never same group twice enforced in backend)
      if (payload?.teamId) {
        setTreatedTeamIds((prev) => new Set(prev).add(payload.teamId));
      }
      if (treatSoundRef.current) {
        treatSoundRef.current.currentTime = 0;
        treatSoundRef.current.play().catch(() => {});
      }
    };

    
    // Mood Check-in updates (no scoring)
    const handleMoodCheckinUpdate = (payload) => {
      if (!payload) return;

      // Accept either {roomCode, teamId, moodCheckin} or {roomCode, teamId, data}
      const rc = (payload.roomCode || payload.code || "").toString().toUpperCase();
      if (rc && roomCode && rc !== roomCode.toUpperCase()) return;

      const teamId = payload.teamId || payload.team || payload?.moodCheckin?.teamId || payload?.data?.teamId || null;
      const checkin = payload.moodCheckin || payload.data || payload.checkin || null;
      if (!teamId || !checkin) return;

      setRoomState((prev) => ({
        ...prev,
        moodCheckins: {
          ...(prev.moodCheckins || {}),
          [teamId]: checkin,
        },
      }));
    };

// Transcript result events from backend
    const handleTranscriptSent = (payload) => {
      setReportProgress({ step: 6, total: 6, label: "Done! Report sent." });
      handleEndSessionAck({ ok: true, ...payload });
    };
    const handleTranscriptError = (payload) => {
      // Show error state in the progress bar instead of hiding it
      setReportProgress((prev) => prev
        ? { ...prev, label: payload?.message || "Email failed — report was saved.", error: true }
        : { step: 5, total: 6, label: payload?.message || "Email failed — report was saved.", error: true }
      );
      handleEndSessionAck({
        ok: false,
        error: payload?.message,
        reportId: payload?.reportId,
      });
    };
    const handleReportProgress = (payload) => {
      if (payload && typeof payload.step === "number") {
        setReportProgress(payload);
      }
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("tasksetLoaded", handleTasksetLoaded);
    socket.on("autoStart:triggered", (payload) => {
      console.log("[LiveSession] Auto-start triggered:", payload);
      setTasksetArmed(false);
      setStatus("Taskset auto-started!");
      setTasksetLaunchAnimating(false);
      setTasksetLaunchProgress(0);
    });
    socket.on("taskSubmission", handleSubmission);
    socket.on("teamJoined", handleTeamJoined);
    socket.on("scanEvent", handleScanEvent);
    socket.on("teacher:roomSetup", handleRoomSetup);
    socket.on("session:noiseLevel", handleNoiseLevel);
    socket.on("teacher:treatAssigned", handleTreatAssigned);

    socket.on("mood-checkin:update", handleMoodCheckinUpdate);

    socket.on("taskset:error", (payload) => {
      console.error("[LiveSession] taskset:error", payload);
      setStatus(payload?.message || "Failed to load taskset.");
      setLaunchingTaskset(false);
      setTasksetLaunchAnimating(false);
      setTasksetLaunchProgress(0);
    });

    // When a task is force-advanced (or auto-advanced), pause so teacher can launch next
    const handleTaskAdvance = (payload) => {
      console.log("[LiveSession] task:advance received:", payload);
      setTaskAdvancedPause(true);
    };
    // When the whole taskset ends, clear pause
    const handleTasksetEnded = () => {
      setTaskAdvancedPause(false);
    };
    socket.on("task:advance", handleTaskAdvance);
    socket.on("taskset:ended", handleTasksetEnded);

    socket.on("transcript:sent", handleTranscriptSent);
    socket.on("transcript:error", handleTranscriptError);
    socket.on("report:progress", handleReportProgress);

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
      socket.off("autoStart:triggered");
      socket.off("taskSubmission", handleSubmission);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("scanEvent", handleScanEvent);
      socket.off("teacher:roomSetup", handleRoomSetup);
      socket.off("session:noiseLevel", handleNoiseLevel);
      socket.off("teacher:treatAssigned", handleTreatAssigned);
      socket.off("mood-checkin:update", handleMoodCheckinUpdate);

      socket.off("taskset:error");
      socket.off("task:advance", handleTaskAdvance);
      socket.off("taskset:ended", handleTasksetEnded);
      socket.off("transcript:sent", handleTranscriptSent);
      socket.off("transcript:error", handleTranscriptError);
      socket.off("report:progress", handleReportProgress);

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
  const handleForceNextTask = () => {
    if (!roomCode) return;
    const code = roomCode.toUpperCase();

    socket.emit("task:force-advance", { roomCode: code });
  };

  const handleSkipTask = () => {
    setTaskAdvancedPause(true);          // optimistic UI — disable button immediately
    handleForceNextTask();
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

  const handleOpenKiosk = () => {
    const code = (roomCode || "").trim().toUpperCase();
    if (!code) return;
    // Host/Presenter kiosk view (opens in new tab)
    const url = `${window.location.origin}/host?room=${encodeURIComponent(code)}${sharedToken ? `&sharedToken=${encodeURIComponent(sharedToken)}` : ""}${reportOwnerName ? `&reportOwnerName=${encodeURIComponent(reportOwnerName)}` : ""}${reportOwnerEmail ? `&reportOwnerEmail=${encodeURIComponent(reportOwnerEmail)}` : ""}${reportOwnerId ? `&reportOwnerId=${encodeURIComponent(reportOwnerId)}` : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleShowRoomLayoutClick = () => {
    if (!isFixedStationTaskset) return;
    setShowRoomSetup(true);
  };



  const handleLaunchQuickTask = () => {
    if (!roomCode) return;

    const tt = String(taskType || "").trim();

    const isGuessWho = tt === (TASK_TYPES.GUESS_WHO || "guess-who") || tt === "guess-who";
    const isEchoChain = tt === (TASK_TYPES.ECHO_CHAIN || "echo-chain") || tt === "echo-chain";
    const isWordWeaver = tt === (TASK_TYPES.WORD_WEAVER_DUEL || "word-weaver-duel") || tt === "word-weaver-duel";
    const isFakeOut = tt === (TASK_TYPES.FAKE_OUT || "fake-out") || tt === "fake-out" || tt === "fakeout";
    const isNarration =
      tt === (TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize") || tt === "narration-synthesize";
    const isRolePlay =
      tt === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck") ||
      tt === "role-play-deck" ||
      tt === (TASK_TYPES.ROLE_PLAY || "role-play") ||
      tt === "role-play" ||
      tt === "roleplay";

    const isDiffDetective = tt === (TASK_TYPES.DIFF_DETECTIVE || "diff-detective") || tt === "diff-detective";
    const isVennSort = tt === (TASK_TYPES.VENNSORT || "vennsort") || tt === "vennsort";
    const isSpeedDraw = tt === (TASK_TYPES.SPEED_DRAW || "speed-draw") || tt === "speed-draw";
    const isDrawMime = tt === (TASK_TYPES.DRAW_MIME || "draw-mime") || tt === "draw-mime";
    const isPhysicalMysteryClues =
      tt === (TASK_TYPES.PHYSICAL_MYSTERY_CLUES || "physical-mystery-clues") || tt === "physical-mystery-clues";

    const isPhotoJournal =
      tt === (TASK_TYPES.PHOTO_JOURNAL || "photo-journal") || tt === "photo-journal" || tt === "photojournal";
    const isPhotoTask = tt === (TASK_TYPES.PHOTO || "photo") || tt === "photo" || tt === "photo-task";
    const isHideNSeek = tt === (TASK_TYPES.HIDENSEEK || "hidenseek") || tt === "hidenseek";

    const isTicTacToe =
      tt === (TASK_TYPES.TRUE_FALSE_TICTACTOE || "true-false-tictactoe") ||
      tt === "true-false-tictactoe" ||
      tt === "truefalse-tictactoe";

    const isMultiPlayerFeedback =
      tt === (TASK_TYPES.MULTI_PLAYER_FEEDBACK || "multi-player-feedback") ||
      tt === "multi-player-feedback" ||
      tt === "multiplayer-feedback";

    const isPronunciation =
      tt === (TASK_TYPES.PRONUNCIATION || "pronunciation") || tt === "pronunciation";

    const isRecordAudio =
      tt === (TASK_TYPES.RECORD_AUDIO || "record-audio") || tt === "record-audio" || tt === "recordaudio";

    const isSpeechRecognition =
      tt === (TASK_TYPES.SPEECH_RECOGNITION || "speech-recognition") ||
      tt === "speech-recognition" ||
      tt === "speech-recognition-answer";

    const isBrainBlitz = tt === (TASK_TYPES.BRAIN_BLITZ || "brainblitz") || tt === "brainblitz";
    const isHangmanDuel = tt === (TASK_TYPES.HANGMAN_DUEL || "hangman-duel") || tt === "hangman-duel";
    const isMoodCheckin = tt === (TASK_TYPES.MOOD_CHECKIN || "mood-checkin") || tt === "mood-checkin";

    const isBrainstormBattle = tt === (TASK_TYPES.BRAINSTORM_BATTLE || "brainstorm-battle") || tt === "brainstorm-battle";
    const isCollaboration = tt === (TASK_TYPES.COLLABORATION || "collaboration") || tt === "collaboration";
    const isLiveDebate = tt === (TASK_TYPES.LIVE_DEBATE || "live-debate") || tt === "live-debate";
    const isPetFeeding = tt === (TASK_TYPES.PET_FEEDING || "pet-feeding") || tt === "pet-feeding";
    const isAiDebateJudge = tt === (TASK_TYPES.AI_DEBATE_JUDGE || "ai-debate-judge") || tt === "ai-debate-judge";


    // Basic validation
    const promptOk = String(taskConfig?.prompt || "").trim().length > 0;
    const hasRawQuickTask = !!(taskConfig && typeof taskConfig.__rawTask === "object" && taskConfig.__rawTask);
    if (
      !isGuessWho &&
      !isEchoChain &&
      !isNarration &&
      !isRolePlay &&
      !isFakeOut &&
      !isDiffDetective &&
      !isVennSort &&
      !isSpeedDraw &&
      !isDrawMime &&
      !isPhysicalMysteryClues &&
      !isPhotoJournal &&
      !isPhotoTask &&
      !isHideNSeek && !isTicTacToe && !isMultiPlayerFeedback && !isRecordAudio && !isMoodCheckin && !isBrainBlitz && !isHangmanDuel && !isBrainstormBattle && !isCollaboration && !isLiveDebate && !isPetFeeding && !isAiDebateJudge && !promptOk && !hasRawQuickTask
    ) {
      return;
    }

    if (isFakeOut) {
      const cfg = taskConfig && typeof taskConfig.config === "object" ? taskConfig.config : {};
      const pc = Number(cfg.playerCount);
      const rounds = Array.isArray(cfg.rounds) ? cfg.rounds : [];
      if (!(pc > 0)) return;
      if (rounds.length === 0) return;
      const ok = rounds.every((r) => {
        const statement = String(r?.statement ?? "").trim();
        const options = Array.isArray(r?.options) ? r.options : [];
        return statement.length > 0 && options.length >= 4;
      });
      if (!ok) return;
    }

    if (isNarration) {
      const pc = Number(taskConfig?.config?.playerCount);
      const prompts = Array.isArray(taskConfig?.config?.prompts) ? taskConfig.config.prompts : [];
      if (!(pc > 0) || prompts.length === 0) return;
      if (prompts.length !== pc) return;
    }

    if (isEchoChain) {
      const seed = String(taskConfig.seedTerm || taskConfig.startTerm || "").trim();
      if (!seed) return;
    }

    if (isRolePlay) {
      const roles = Array.isArray(taskConfig?.config?.roles) ? taskConfig.config.roles : [];
      const scenario = String(taskConfig?.config?.scenario || "").trim();
      if (roles.length === 0 || !scenario) return;
    }

    if (isDiffDetective) {
      const original = String(taskConfig.original || "").trim();
      const modified = String(taskConfig.modified || "").trim();
      if (!original || !modified) return;
    }

    if (isVennSort) {
      const cats = Array.isArray(taskConfig?.config?.categories)
        ? taskConfig.config.categories
        : Array.isArray(taskConfig?.categories)
        ? taskConfig.categories
        : [];
      const items = Array.isArray(taskConfig?.config?.items)
        ? taskConfig.config.items
        : Array.isArray(taskConfig?.items)
        ? taskConfig.items
        : [];
      if (cats.filter(Boolean).length < 2) return;
      if (items.filter(Boolean).length < 3) return;
    }

    if (isSpeedDraw) {
      const w = String(taskConfig.word || taskConfig?.config?.word || "").trim();
      if (!w) return;
    }

    if (isDrawMime) {
      const cfg = taskConfig && typeof taskConfig.config === "object" ? taskConfig.config : {};
      const prompts = Array.isArray(cfg.prompts)
        ? cfg.prompts
        : Array.isArray(taskConfig.prompts)
        ? taskConfig.prompts
        : [];
      if (prompts.length === 0) return;
    }

    if (isPhysicalMysteryClues) {
      const clues = Array.isArray(taskConfig.clues) ? taskConfig.clues : [];
      if (clues.length === 0) return;
    }

    if (isHideNSeek) {
      const pr = String(
        taskConfig?.config?.pageReference ||
          taskConfig?.config?.pageRef ||
          taskConfig?.pageReference ||
          ""
      ).trim();
      if (!pr) return;
    }

    // Defaults from shared meta if present
    const typeMetaForLaunch = TASK_TYPE_META[tt] || {};
    const objectiveScoringDefault = !!typeMetaForLaunch.objectiveScoring;
    const aiScoringRequiredDefault =
      typeof typeMetaForLaunch.aiScoringRequired === "boolean"
        ? typeMetaForLaunch.aiScoringRequired
        : tt === (TASK_TYPES.OPEN_TEXT || "open-text") || tt === (TASK_TYPES.SHORT_ANSWER || "short-answer");

    const rawQuickTask =
      taskConfig && typeof taskConfig.__rawTask === "object" && taskConfig.__rawTask
        ? taskConfig.__rawTask
        : null;

    let taskToSend;

    // If the AI generator already gave us a full task object, keep it intact so we don't
    // accidentally drop task-specific fields (config, rounds, speaker roles, etc.).
    if (rawQuickTask) {
      const meta = typeMetaForLaunch || {};

      taskToSend = {
        ...rawQuickTask,
        taskType: tt || rawQuickTask.taskType || (TASK_TYPES.SHORT_ANSWER || "short-answer"),
      };

      // Normalize core fields / sensible defaults
      const promptStr = String(rawQuickTask.prompt ?? taskConfig.prompt ?? "").trim();
      taskToSend.prompt = promptStr || "Quick Task";

      if (typeof taskToSend.interTeamEnabled !== "boolean") taskToSend.interTeamEnabled = !!meta.interTeamEnabled;
      if (typeof taskToSend.intraTeamEnabled !== "boolean") taskToSend.intraTeamEnabled = !!meta.intraTeamEnabled;
      if (typeof taskToSend.objectiveScoring !== "boolean") taskToSend.objectiveScoring = !!objectiveScoringDefault;
      if (typeof taskToSend.aiScoringRequired !== "boolean") taskToSend.aiScoringRequired = !!aiScoringRequiredDefault;

      if (typeof taskToSend.points !== "number") {
        taskToSend.points = typeof taskConfig.points === "number" ? taskConfig.points : 10;
      }

      taskToSend.subject = taskToSend.subject || taskConfig.subject || "Ad-hoc";
      taskToSend.gradeLevel = taskToSend.gradeLevel || taskConfig.gradeLevel || "";

      if (!Number(taskToSend.timeLimitSeconds) && Number(taskConfig.timeLimitSeconds) > 0) {
        taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds);
      }

      taskToSend.reviewPauseSeconds =
        Number(reviewPauseSeconds) > 0
          ? Number(reviewPauseSeconds)
          : Number(taskToSend.reviewPauseSeconds) > 0
          ? Number(taskToSend.reviewPauseSeconds)
          : 15;

      // Remove internal editor-only keys (never send to students)
      delete taskToSend.__rawTask;
      delete taskToSend.__generatedAt;
    } else {
      taskToSend = {
      taskType: tt || (TASK_TYPES.SHORT_ANSWER || "short-answer"),
      interTeamEnabled: false,
      intraTeamEnabled: false,
      objectiveScoring: objectiveScoringDefault,
      aiScoringRequired: aiScoringRequiredDefault,
      prompt: String(taskConfig.prompt || "").trim(),
      correctAnswer: taskConfig.correctAnswer || null,
      options:
        Array.isArray(taskConfig.options) && taskConfig.options.length > 0 ? taskConfig.options : undefined,
      items:
        Array.isArray(taskConfig.items) && taskConfig.items.length > 0 ? taskConfig.items : undefined,
      config:
        taskConfig && typeof taskConfig.config === "object" && taskConfig.config ? taskConfig.config : undefined,
      points: typeof taskConfig.points === "number" ? taskConfig.points : 10,
      subject: taskConfig.subject || "Ad-hoc",
      gradeLevel: taskConfig.gradeLevel || "",
      timeLimitSeconds: taskConfig.timeLimitSeconds || undefined,
      reviewPauseSeconds: reviewPauseSeconds || 15,
    };
    }

    // ---- Type-specific normalization ----

    if (isFakeOut) {
      const cfg = taskConfig && typeof taskConfig.config === "object" ? taskConfig.config : {};
      const pc = Number(cfg.playerCount) > 0 ? Number(cfg.playerCount) : 4;
      const rounds = Array.isArray(cfg.rounds) ? cfg.rounds : [];
      taskToSend.prompt =
        String(taskConfig.prompt || "").trim() ||
        "Fake Out: One player reads aloud; everyone else listens and votes.";
      taskToSend.config = {
        ...(cfg || {}),
        playerCount: pc,
        rounds,
        perTurnSeconds: Number(cfg.perTurnSeconds) > 0 ? Number(cfg.perTurnSeconds) : 45,
        readerBonusPoints: Number(cfg.readerBonusPoints) > 0 ? Number(cfg.readerBonusPoints) : 5,
      };
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 90;
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = true;
      taskToSend.aiScoringRequired = false;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isGuessWho) {
      const secrets = Array.isArray(taskConfig.secretAnswers)
        ? taskConfig.secretAnswers
        : taskConfig.secretAnswer
        ? [taskConfig.secretAnswer]
        : [];
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Ask yes/no questions to identify the secret concept.";
      taskToSend.secretAnswers = secrets.map((s) => String(s || "").trim()).filter(Boolean);
      taskToSend.category = String(taskConfig.category || taskConfig.topic || taskConfig.subject || "").trim() || undefined;
      taskToSend.maxGuesses = Number(taskConfig.maxGuesses) > 0 ? Number(taskConfig.maxGuesses) : 10;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 60;
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isEchoChain) {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Repeat the chain aloud and add one related term each turn.";
      taskToSend.seedTerm = String(taskConfig.seedTerm || taskConfig.startTerm || "").trim();
      taskToSend.config = {
        perTurnSeconds: Number(taskConfig.perTurnSeconds) > 0 ? Number(taskConfig.perTurnSeconds) : 10,
        pointsPerCorrectAdd: Number(taskConfig.pointsPerCorrectAdd) > 0 ? Number(taskConfig.pointsPerCorrectAdd) : 2,
        rotationBonusPoints: Number(taskConfig.rotationBonusPoints) > 0 ? Number(taskConfig.rotationBonusPoints) : 10,
        maxChainLength: Number(taskConfig.maxChainLength) > 0 ? Number(taskConfig.maxChainLength) : 30,
        requireVocabOnly: !!taskConfig.requireVocabOnly,
      };
      taskToSend.timeLimitSeconds = Number(taskConfig.perTurnSeconds) > 0 ? Number(taskConfig.perTurnSeconds) : 10;
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isWordWeaver) {
      const phrase = String(taskConfig.targetPhrase || taskConfig.phrase || taskConfig.solution || taskConfig.answerPhrase || "").trim();
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Rebuild the phrase by placing the correct words in order.";
      taskToSend.targetPhrase = phrase;
      const rawBank = taskConfig.wordBank || taskConfig.words || taskConfig.bank || taskConfig.aiWordBank || taskConfig.aiWords || null;
      const bank = Array.isArray(rawBank) ? rawBank.map((w) => String(w || "").trim()).filter(Boolean) : [];
      taskToSend.wordBank = bank.length ? bank : (phrase ? phrase.split(/\s+/).filter(Boolean) : []);
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 240;
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isRolePlay) {
      taskToSend.taskType = TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck";
      taskToSend.prompt =
        String(taskConfig?.prompt || "").trim() ||
        String(taskConfig?.config?.scenario || "").trim() ||
        "Draw roles and role-play the scenario together.";
      taskToSend.timeLimitSeconds = Number(taskConfig?.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 180;
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.config = {
        mode: taskConfig?.config?.mode || "choose",
        scenario: String(taskConfig?.config?.scenario || "").trim(),
        roles: Array.isArray(taskConfig?.config?.roles) ? taskConfig.config.roles : [],
        playerCount: Number(taskConfig?.config?.playerCount) > 0 ? Number(taskConfig.config.playerCount) : undefined,
        playerNames: Array.isArray(taskConfig?.config?.playerNames) ? taskConfig.config.playerNames : undefined,
      };
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isNarration) {
      taskToSend.prompt =
        String(taskConfig.prompt || "").trim() ||
        "Take turns narrating these concept prompts to your team. Rate each speaker for clarity/accuracy.";
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.config = {
        playerCount:
          Number(taskConfig?.config?.playerCount) > 0
            ? Number(taskConfig.config.playerCount)
            : (Array.isArray(taskConfig?.config?.prompts) ? taskConfig.config.prompts.length : 0),
        prompts: Array.isArray(taskConfig?.config?.prompts) ? taskConfig.config.prompts : [],
        perTurnSeconds: Number(taskConfig?.config?.perTurnSeconds) >= 0 ? Number(taskConfig.config.perTurnSeconds) : 60,
        ratingScale: taskConfig?.config?.ratingScale || { min: 1, max: 5, label: "Clarity / accuracy" },
      };
      taskToSend.timeLimitSeconds = Number(taskConfig?.config?.perTurnSeconds) > 0 ? Number(taskConfig.config.perTurnSeconds) : 60;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isDiffDetective) {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Spot the differences and list everything that changed.";
      taskToSend.original = taskConfig.original || "";
      taskToSend.modified = taskConfig.modified || "";
      taskToSend.differences = Array.isArray(taskConfig.differences) ? taskConfig.differences : [];
      taskToSend.objectiveScoring = Array.isArray(taskConfig.differences) && taskConfig.differences.length > 0;
      taskToSend.aiScoringRequired = !taskToSend.objectiveScoring;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isVennSort) {
      const cats = Array.isArray(taskConfig?.config?.categories) ? taskConfig.config.categories : Array.isArray(taskConfig?.categories) ? taskConfig.categories : [];
      const items = Array.isArray(taskConfig?.config?.items) ? taskConfig.config.items : Array.isArray(taskConfig?.items) ? taskConfig.items : [];
      const ca =
        (taskConfig?.correctAnswer && typeof taskConfig.correctAnswer === "object"
          ? taskConfig.correctAnswer
          : (taskConfig?.config?.correctAnswer && typeof taskConfig.config.correctAnswer === "object"
            ? taskConfig.config.correctAnswer
            : null));
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Sort each item into the correct region of the Venn diagram.";
      taskToSend.config = {
        ...(taskToSend.config || {}),
        categories: cats,
        items,
        correctAnswer: ca || undefined,
        pointsPerCorrectCategory: Number(taskConfig?.config?.pointsPerCorrectCategory) > 0 ? Number(taskConfig.config.pointsPerCorrectCategory) : 2,
      };
      taskToSend.correctAnswer = ca || undefined;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 90;
      taskToSend.objectiveScoring = !!ca;
      taskToSend.aiScoringRequired = false;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isDrawMime) {
      const cfg = taskConfig && typeof taskConfig.config === "object" ? taskConfig.config : {};
      const prompts = Array.isArray(cfg.prompts) ? cfg.prompts : Array.isArray(taskConfig.prompts) ? taskConfig.prompts : [];
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Draw or mime the concept so your teammates can guess it!";
      taskToSend.config = {
        ...cfg,
        prompts,
        perTurnSeconds: Number(cfg.perTurnSeconds) > 0 ? Number(cfg.perTurnSeconds) : 60,
        mode: String(cfg.mode || taskConfig.mode || "choose"),
      };
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 60;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isSpeedDraw) {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Speed Draw: one player draws fast; teammates guess fast!";
      taskToSend.word = String(taskConfig.word || taskConfig?.config?.word || "").trim();
      taskToSend.difficulty = String(taskConfig.difficulty || taskConfig?.config?.difficulty || "MEDIUM").toUpperCase();
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 60;
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isPhysicalMysteryClues) {
      taskToSend.prompt =
        String(taskConfig.prompt || "").trim() ||
        "Physical Mystery Clues: find the clue(s) and submit the correct solution.";
      taskToSend.clues = Array.isArray(taskConfig.clues) ? taskConfig.clues : [];
      taskToSend.solution = taskConfig.solution || taskConfig.answer || undefined;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 120;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isPhotoJournal) {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Take a photo as evidence AND write a short caption explaining it.";
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 120;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = true;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isPhotoTask) {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Take a photo as proof that you completed the prompt.";
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 90;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = true;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    if (isHideNSeek) {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Find the reference, take a photo, and explain why it matters.";
      const pageReference = String(taskConfig?.config?.pageReference || taskConfig?.config?.pageRef || taskConfig?.pageReference || "").trim();
      taskToSend.config = { ...(taskToSend.config || {}), pageReference };
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 180;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = true;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
    }

    // Brain Spark Notes: pass bullets to students (if present)
    if (tt === (TASK_TYPES.BRAIN_SPARK_NOTES || "brain-spark-notes")) {
      taskToSend.bullets = Array.isArray(taskConfig.bullets) ? taskConfig.bullets : [];
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
    }

    // FLASHCARDS: parse bulk input into cards[]
    if (tt === (TASK_TYPES.FLASHCARDS || "flashcards") && quickFlashcardsText.trim()) {
      const lines = quickFlashcardsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const cards = lines.map((line, idx) => {
        const [term, def] = line.split(/\s*[-–—]\s*/);
        return { id: String(idx), question: term || line, answer: def || "" };
      });
      if (cards.length > 0) taskToSend.cards = cards;
    }

    // Normalize/attach payload fields for objective-solo tasks (matching/sequence/sort/timeline)
    if (isOneOfObjectiveSolo(taskToSend.taskType)) {
      const lower = String(taskToSend.taskType || "").toLowerCase();

      if (lower === String(TASK_TYPES.MATCHING || "matching")) {
        const pairs = Array.isArray(taskConfig.pairs) ? taskConfig.pairs : [];
        if (pairs.length > 0) {
          const leftItems = pairs.map((p, i) => p?.left ?? p?.a ?? p?.promptLeft ?? `Left ${i + 1}`);
          const rightItems = pairs.map((p, i) => p?.right ?? p?.b ?? p?.promptRight ?? `Right ${i + 1}`);
          const correctMatches = {};
          pairs.forEach((p) => {
            const l = String(p?.left ?? p?.a ?? "").trim();
            const r = String(p?.right ?? p?.b ?? "").trim();
            if (l && r) correctMatches[l] = r;
          });
          taskToSend.leftItems = leftItems;
          taskToSend.rightItems = rightItems;
          taskToSend.correctMatches = correctMatches;
        } else {
          taskToSend.leftItems = Array.isArray(taskConfig.leftItems) ? taskConfig.leftItems : [];
          taskToSend.rightItems = Array.isArray(taskConfig.rightItems) ? taskConfig.rightItems : [];
          taskToSend.correctMatches = taskConfig.correctMatches && typeof taskConfig.correctMatches === "object" ? taskConfig.correctMatches : {};
        }
        taskToSend.objectiveScoring = true;
        taskToSend.aiScoringRequired = false;
        taskToSend.interTeamEnabled = false;
        taskToSend.intraTeamEnabled = false;
      }

      if (lower === String(TASK_TYPES.SORT || "sort")) {
        // Prefer top-level categories, but fall back to config.buckets (used by AI generator)
        taskToSend.categories =
          Array.isArray(taskConfig.categories) && taskConfig.categories.length > 0
            ? taskConfig.categories
            : Array.isArray(taskConfig.config?.buckets) && taskConfig.config.buckets.length > 0
            ? taskConfig.config.buckets
            : [];
        taskToSend.items =
          Array.isArray(taskConfig.items) && taskConfig.items.length > 0
            ? taskConfig.items
            : Array.isArray(taskConfig.config?.items) && taskConfig.config.items.length > 0
            ? taskConfig.config.items
            : [];
        taskToSend.correctCategoryByItem =
          taskConfig.correctCategoryByItem && typeof taskConfig.correctCategoryByItem === "object"
            ? taskConfig.correctCategoryByItem
            : undefined;
        taskToSend.objectiveScoring = true;
        taskToSend.aiScoringRequired = false;
        taskToSend.interTeamEnabled = false;
        taskToSend.intraTeamEnabled = false;
      }

      if (lower === String(TASK_TYPES.SEQUENCE || "sequence") || lower === String(TASK_TYPES.TIMELINE || "timeline")) {
        const items = Array.isArray(taskConfig.items) ? taskConfig.items : Array.isArray(taskConfig.events) ? taskConfig.events : [];
        taskToSend.items = items;
        taskToSend.correctOrder = Array.isArray(taskConfig.correctOrder) ? taskConfig.correctOrder : undefined;
        taskToSend.config = {
          ...(taskToSend.config || {}),
          items,
          correctOrder: Array.isArray(taskConfig.correctOrder) ? taskConfig.correctOrder : undefined,
          ...(lower === String(TASK_TYPES.TIMELINE || "timeline") ? { layout: "horizontal", showYears: true } : {}),
        };
        taskToSend.objectiveScoring = true;
        taskToSend.aiScoringRequired = false;
        taskToSend.interTeamEnabled = false;
        taskToSend.intraTeamEnabled = false;
      }
    }


    // --- Extra quick-launch normalization for newer task types ---

    // ✅ TRUE/FALSE TIC-TAC-TOE
    if (tt === (TASK_TYPES.TRUE_FALSE_TICTACTOE || "true-false-tictactoe") || tt === "true-false-tictactoe") {
      const stmts = Array.isArray(taskConfig.statements)
        ? taskConfig.statements
        : Array.isArray(taskConfig.config?.statements)
        ? taskConfig.config.statements
        : [];
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Drag a True/False statement onto the board to claim squares.";
      taskToSend.statements = stmts;
      taskToSend.board = Array.isArray(taskConfig.board) && taskConfig.board.length === 9 ? taskConfig.board : Array(9).fill(null);
      taskToSend.intraTeamEnabled = true;
      taskToSend.objectiveScoring = true;
      taskToSend.aiScoringRequired = false;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 90;
      taskToSend.points = typeof taskConfig.points === "number" ? taskConfig.points : 10;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
      taskToSend.config = undefined;
    }

    // ✅ PRONUNCIATION
    if (tt === (TASK_TYPES.PRONUNCIATION || "pronunciation") || tt === "pronunciation") {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Pronunciation Practice: record yourself saying the target text.";
      taskToSend.referenceText = taskConfig.referenceText || "";
      taskToSend.phonetic = taskConfig.phonetic || "";
      taskToSend.accentOptions = Array.isArray(taskConfig.accentOptions) ? taskConfig.accentOptions : ["american", "british", "canadian", "neutral"];
      taskToSend.targetAccent = taskConfig.targetAccent || taskToSend.accentOptions[0] || "american";
      taskToSend.language = taskConfig.language || "English";
      taskToSend.intraTeamEnabled = false;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = true;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : undefined;
      taskToSend.points = typeof taskConfig.points === "number" ? taskConfig.points : 10;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
      taskToSend.config = undefined;
    }

    // ✅ RECORD AUDIO
    if (tt === (TASK_TYPES.RECORD_AUDIO || "record-audio") || tt === "record-audio") {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Record an oral answer. Your teacher will listen later.";
      taskToSend.intraTeamEnabled = false;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : undefined;
      taskToSend.points = typeof taskConfig.points === "number" ? taskConfig.points : 0;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
      taskToSend.config = undefined;
    }

    // ✅ SPEECH RECOGNITION
    if (tt === (TASK_TYPES.SPEECH_RECOGNITION || "speech-recognition") || tt === "speech-recognition") {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Speak your answer clearly. Curriculate will transcribe and score it.";
      taskToSend.referenceText = taskConfig.referenceText || "";
      taskToSend.language = taskConfig.language || "en-US";
      taskToSend.intraTeamEnabled = false;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = true;
      taskToSend.timeLimitSeconds = Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 60;
      taskToSend.points = typeof taskConfig.points === "number" ? taskConfig.points : 10;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
      taskToSend.config = undefined;
    }

    // ✅ READING COMP (AI paragraph + 1-sentence response; intra-team only)
    if (tt === (TASK_TYPES.READING_COMP || "reading-comp") || tt === "reading-comp") {
      const paragraph = String(
        taskConfig.generatedParagraph || taskConfig.paragraph || taskConfig.text || ""
      ).trim();

      taskToSend.prompt =
        String(taskConfig.prompt || "").trim() ||
        "Read the paragraph and write ONE sentence that shows you understood it.";

      // ReadingCompTask consumes `generatedParagraph` (top-level) and also tolerates config.
      taskToSend.generatedParagraph = paragraph;
      taskToSend.intraTeamEnabled = true;
      taskToSend.interTeamEnabled = false;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = true;
      taskToSend.timeLimitSeconds =
        Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 0;
      taskToSend.points = typeof taskConfig.points === "number" ? taskConfig.points : 10;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
      taskToSend.config = {
        ...(taskConfig.config && typeof taskConfig.config === "object" ? taskConfig.config : {}),
        generatedParagraph: paragraph,
        // Optional: team size for turn-based variation. Safe default.
        playerCount:
          Number(taskConfig.playerCount) > 0
            ? Number(taskConfig.playerCount)
            : Array.isArray(members)
            ? Math.max(1, members.filter((m) => String(m || "").trim()).length)
            : 1,
      };
    }

    // ✅ MULTI-PLAYER FEEDBACK
    if (tt === (TASK_TYPES.MULTI_PLAYER_FEEDBACK || "multi-player-feedback") || tt === "multi-player-feedback") {
      taskToSend.prompt = String(taskConfig.prompt || "").trim() || "Quick team feedback: rate the session and share one improvement.";
      taskToSend.intraTeamEnabled = false;
      taskToSend.objectiveScoring = false;
      taskToSend.aiScoringRequired = false;
      taskToSend.timeLimitSeconds = undefined;
      taskToSend.points = 0;
      taskToSend.correctAnswer = null;
      taskToSend.options = undefined;
      taskToSend.items = undefined;
      taskToSend.config = undefined;
    }
    setIsLaunchingQuick(true);
    setQuickStatus(null);

    socket.emit("teacherLaunchTask", {
      roomCode: roomCode.toUpperCase(),
      task: taskToSend,
      selectedRooms: selectedRooms.length > 0 ? selectedRooms : undefined,
    });

    setTimeout(() => {
      setIsLaunchingQuick(false);
      setQuickStatus("Quick task launched!");
    }, 300);

    setLastQuickTask(taskToSend);
    setQuickFlashcardsText("");
  };
  const handleGenerateQuickTask = async () => {
    if (!roomCode) {
      alert("You must have a room code to generate a task.");
      return;
    }

    // Fast-path: "Mad Dash" is a non-AI, runtime-generated movement race.
    // It should be Quick-Launchable without requiring any word list.
    if (taskType === (TASK_TYPES.MAD_DASH || "mad-dash") || taskType === "mad-dash") {
      const len = Math.max(3, Math.min(5, Math.round(3 + Math.random() * 2)));
      const pool = Array.isArray(COLORS) && COLORS.length ? COLORS : ["red", "blue", "green", "yellow", "purple"];
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const sequence = shuffled.slice(0, len);

      const cfg = {
        taskType: TASK_TYPES.MAD_DASH || "mad-dash",
        title: "Mad Dash",
        prompt:
          "Watch the colour route, then scan the stations IN ORDER as fast as you can. Wrong scan resets to the start.",
        sequence,
        availableColors: pool,
        interTeamEnabled: true,
        intraTeamEnabled: true,
        timed: true,
        timeBonus: true,
        points: 10,
        // Task component reads config.* (fallbacks exist).
        config: {
          sequence,
          revealMs: 6000,
          bestTimeBonusPoints: 5,
        },
      };

      setTaskType(cfg.taskType);
      setTaskConfig(cfg);
      setLastQuickTask(cfg);
      setShowAiGen(false);
      setAiError(null);
      setIsGenerating(false);
      return;
    }


    const rawWords = (aiWordList || "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    // For many quick tasks we want at least 1 key term.
    // For objective-solo tasks (matching/sequence/sort/timeline) we allow generation without a word list.
    // Also allow wordless generation for tasks where the teacher prompt is the main driver (e.g., AI Debate Judge).
    const wordlessTypes = new Set([
      TASK_TYPES.AI_DEBATE_JUDGE || "ai-debate-judge",
      // These are typically prompt-driven or non-word-bank flows.
      TASK_TYPES.RECORD_AUDIO || "record-audio",
      TASK_TYPES.MULTI_PLAYER_FEEDBACK || "multi-player-feedback",
      TASK_TYPES.MOOD_CHECKIN || "mood-checkin",
      // Reading Comp can be generated from topic + grade without requiring an explicit word list.
      TASK_TYPES.READING_COMP || "reading-comp",
    ]);
    const needsWords = !isOneOfObjectiveSolo(taskType) && !wordlessTypes.has(taskType);
    if (rawWords.length === 0 && needsWords) {
      alert(
        "Please enter at least one vocabulary word or key term (e.g. 'photosynthesis', 'Confederation')."
      );
      return;
    }

    setIsGenerating(true);
    setAiError(null);

    try {
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;

      const gradeStr = aiGrade ? String(aiGrade).trim() : "";

      const typeMeta = TASK_TYPE_META[taskType] || {};
      const isMultiCapable = !!typeMeta.multiItemCapable;
      const desiredNumTasks = isMultiCapable ? 5 : 1;

      const payload = {
        title: "Quick Task",
        description: aiPurpose || "",
        purpose: aiPurpose || undefined,
        numTasks: desiredNumTasks,
        taskType,
        requiredTaskTypes: [taskType],
        gradeLevel: gradeStr
          ? gradeStr.toLowerCase().startsWith("grade")
            ? gradeStr
            : `Grade ${gradeStr}`
          : undefined,
        grade: gradeStr || undefined,
        difficulty: aiDifficulty || "medium",
        subject: aiSubject || undefined,
        aiWordBank: aiWordList
          .split(/[\n,]+/)
          .map((w) => w.trim())
          .filter(Boolean),
        words: rawWords,
        wordList: rawWords,
        keyTerms: rawWords,
        vocabulary: rawWords,
        roomCode: roomCode.toUpperCase(),
        mode: "quick-live-session",
      };

// If RolePlay Deck, fold any teacher-entered scenario/roles into the description as strong guidance.
const isRolePlayRequested =
  taskType === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck") ||
  taskType === "role-play-deck" ||
  taskType === TASK_TYPES.ROLE_PLAY ||
  taskType === "role-play" ||
  taskType === "roleplay";

if (isRolePlayRequested) {
  const rolesHint = String(rolePlayRolesText || "").trim();
  const scenarioHint = String(rolePlayScenarioText || "").trim();
  const modeHint = String(rolePlayMode || "choose").trim();

  const guidanceParts = [];
  guidanceParts.push("This is a RolePlay Deck task (intra-team only).");
  guidanceParts.push(`Mode: ${modeHint}.`);
  if (scenarioHint) guidanceParts.push(`Scenario seed: ${scenarioHint}`);
  if (rolesHint) guidanceParts.push(`Roles seed list (teacher provided):\n${rolesHint}`);
  guidanceParts.push("Return config.roles[] and config.scenario. Keep it school-appropriate and respectful.");

  // Append to description (backend uses this as prompt context)
  payload.description = [payload.description || "", guidanceParts.join("\n\n")].filter(Boolean).join("\n\n");
}

      console.log("[LiveSession] AI quick-task payload:", payload);

      const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      console.log("[LiveSession] AI quick-task response:", res.status, text);

      let data = text ? JSON.parse(text) : null;

      if (!res.ok) {
        throw new Error(data?.error || `AI generator error (${res.status})`);
      }

      const taskset = data?.taskset || data;
      const tasks = Array.isArray(taskset?.tasks)
        ? taskset.tasks
        : Array.isArray(data?.tasks)
        ? data.tasks
        : [];

      if (!tasks.length) {
        throw new Error("AI did not return a task.");
      }

      const baseTask = tasks[0];
      const generatedType =
        baseTask.taskType || baseTask.task_type || taskType;

      setTaskType(generatedType);

      // ✅ MATCHING / SEQUENCE / SORT / TIMELINE (objective solo) – map to quick-launch config
      const genTypeLower = String(generatedType || "").toLowerCase();

      // 🏁 Mad Dash Sequence — normalize AI output into the runtime schema expected by student app
      if (
        genTypeLower === String(TASK_TYPES.MAD_DASH_SEQUENCE || "mad-dash-sequence") ||
        genTypeLower === "mad-dash-sequence"
      ) {
        const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
        const items = Array.isArray(cfg.items) && cfg.items.length ? cfg.items : Array.isArray(baseTask.items) ? baseTask.items : [];
        const correctOrder =
          Array.isArray(cfg.correctOrder) && cfg.correctOrder.length
            ? cfg.correctOrder
            : Array.isArray(baseTask.correctOrder)
            ? baseTask.correctOrder
            : Array.isArray(baseTask.order)
            ? baseTask.order
            : [];

        setTaskConfig({
          taskType: TASK_TYPES.MAD_DASH_SEQUENCE || "mad-dash-sequence",
          title: baseTask.title || "Mad Dash Sequence",
          prompt:
            baseTask.prompt ||
            "Figure out the correct order, then scan the stations in that order as fast as you can.",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          timed: true,
          timeBonus: true,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          interTeamEnabled: true,
          intraTeamEnabled: true,
          config: {
            ...cfg,
            items: Array.isArray(items) ? items.slice(0, 5) : [],
            correctOrder: Array.isArray(correctOrder) ? correctOrder : [],
            bestTimeBonusPoints:
              Number(cfg.bestTimeBonusPoints) > 0 ? Number(cfg.bestTimeBonusPoints) : 5,
          },
        });

        setShowAiGen(false);
        return;
      }

      // MATCHING
      if (genTypeLower === String(TASK_TYPES.MATCHING || "matching")) {
        const pairs = Array.isArray(baseTask.pairs) ? baseTask.pairs : [];
        let leftItems = [];
        let rightItems = [];
        let correctMatches = {};

        if (pairs.length > 0) {
          leftItems = pairs.map((p, i) => String(p?.left ?? p?.a ?? `Left ${i + 1}`).trim());
          rightItems = pairs.map((p, i) => String(p?.right ?? p?.b ?? `Right ${i + 1}`).trim());
          pairs.forEach((p) => {
            const l = String(p?.left ?? p?.a ?? "").trim();
            const r = String(p?.right ?? p?.b ?? "").trim();
            if (l && r) correctMatches[l] = r;
          });
        } else {
          leftItems = Array.isArray(baseTask.leftItems) ? baseTask.leftItems : (Array.isArray(baseTask.left) ? baseTask.left : []);
          rightItems = Array.isArray(baseTask.rightItems) ? baseTask.rightItems : (Array.isArray(baseTask.right) ? baseTask.right : []);
          correctMatches =
            baseTask.correctMatches && typeof baseTask.correctMatches === "object"
              ? baseTask.correctMatches
              : baseTask.answerKey && typeof baseTask.answerKey === "object"
              ? baseTask.answerKey
              : {};
        }

        setTaskConfig({
          prompt: baseTask.prompt || "Match the items.",
          leftItems,
          rightItems,
          correctMatches,
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 90,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: true,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

      // SORT
      if (genTypeLower === String(TASK_TYPES.SORT || "sort")) {
        const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
        const categories =
          Array.isArray(baseTask.categories) && baseTask.categories.length ? baseTask.categories :
          Array.isArray(baseTask.buckets) && baseTask.buckets.length ? baseTask.buckets.map((b) => b?.title ?? b?.name ?? String(b)) :
          Array.isArray(cfg.buckets) && cfg.buckets.length ? cfg.buckets.map((b) => b?.title ?? b?.name ?? String(b)) :
          [];
        const items =
          Array.isArray(baseTask.items) && baseTask.items.length ? baseTask.items :
          Array.isArray(cfg.items) && cfg.items.length ? cfg.items :
          Array.isArray(baseTask.cards) ? baseTask.cards :
          [];
        let correctCategoryByItem =
          baseTask.correctCategoryByItem && typeof baseTask.correctCategoryByItem === "object"
            ? baseTask.correctCategoryByItem
            : {};

        // If items are objects with category field, build mapping
        if ((!correctCategoryByItem || Object.keys(correctCategoryByItem).length === 0) && items.some((it) => it && typeof it === "object")) {
          correctCategoryByItem = {};
          items.forEach((it) => {
            const label = String(it.label ?? it.text ?? it.item ?? it.term ?? it.name ?? "").trim();
            const cat = String(it.category ?? it.correctCategory ?? it.bucket ?? it.group ?? "").trim();
            if (label && cat) correctCategoryByItem[label] = cat;
          });
        }

        setTaskConfig({
          prompt: baseTask.prompt || "Sort the items into the correct categories.",
          categories,
          items,
          correctCategoryByItem,
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 90,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: true,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

      // SEQUENCE / TIMELINE
      if (
        genTypeLower === String(TASK_TYPES.SEQUENCE || "sequence") ||
        genTypeLower === String(TASK_TYPES.TIMELINE || "timeline")
      ) {
        const items =
          Array.isArray(baseTask.items) ? baseTask.items :
          Array.isArray(baseTask.events) ? baseTask.events :
          Array.isArray(baseTask.steps) ? baseTask.steps :
          [];
        const correctOrder =
          Array.isArray(baseTask.correctOrder) ? baseTask.correctOrder :
          Array.isArray(baseTask.order) ? baseTask.order :
          Array.isArray(baseTask.correctSequence) ? baseTask.correctSequence :
          undefined;

        setTaskConfig({
          prompt:
            baseTask.prompt ||
            (genTypeLower === String(TASK_TYPES.TIMELINE || "timeline")
              ? "Place the events in chronological order on the timeline."
              : "Put the steps in the correct order."),
          items,
          correctOrder,
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 90,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: true,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

      const generatedMeta = TASK_TYPE_META[generatedType] || {};
      const generatedIsMulti = !!generatedMeta.multiItemCapable;

      // 🔵 DiffDetective
      if (generatedType === TASK_TYPES.DIFF_DETECTIVE) {
        setTaskConfig({
          prompt: baseTask.prompt || "",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          original: baseTask.original || "",
          modified: baseTask.modified || "",
          differences: Array.isArray(baseTask.differences) ? baseTask.differences : [],
        });
        setShowAiGen(false);
        return;
      }


      // 🟣 VennSort
      if (generatedType === (TASK_TYPES.VENNSORT || "vennsort") || generatedType === "vennsort") {
        const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
        const circles =
          Array.isArray(cfg.circles) && cfg.circles.length
            ? cfg.circles
            : Array.isArray(baseTask.circles)
            ? baseTask.circles
            : [];
        const items =
          Array.isArray(cfg.items) && cfg.items.length ? cfg.items : Array.isArray(baseTask.items) ? baseTask.items : [];
        setTaskConfig({
          prompt: baseTask.prompt || "",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 90,
          config: {
            circles,
            items,
            pointsPerCorrectCategory:
              Number(cfg.pointsPerCorrectCategory) > 0 ? Number(cfg.pointsPerCorrectCategory) : 2,
          },
        });
        setShowAiGen(false);
        return;
      }

      // 🟠 Draw/Mime
      if (generatedType === (TASK_TYPES.DRAW_MIME || "draw-mime") || generatedType === "draw-mime") {
        const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
        const prompts =
          Array.isArray(cfg.prompts) && cfg.prompts.length
            ? cfg.prompts
            : Array.isArray(baseTask.prompts)
            ? baseTask.prompts
            : [];
        setTaskConfig({
          prompt: baseTask.prompt || "",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 60,
          config: {
            ...cfg,
            prompts,
            perTurnSeconds: Number(cfg.perTurnSeconds) > 0 ? Number(cfg.perTurnSeconds) : 60,
            mode: String(cfg.mode || "choose"),
          },
        });
        setShowAiGen(false);
        return;
      }

      // 🟡 SpeedDraw
      if (generatedType === (TASK_TYPES.SPEED_DRAW || "speed-draw") || generatedType === "speed-draw") {
        const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
        const prompts =
          Array.isArray(cfg.prompts) && cfg.prompts.length
            ? cfg.prompts
            : Array.isArray(baseTask.prompts)
            ? baseTask.prompts
            : [];
        setTaskConfig({
          prompt: baseTask.prompt || "",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 60,
          config: {
            ...cfg,
            prompts,
            perRoundSeconds: Number(cfg.perRoundSeconds) > 0 ? Number(cfg.perRoundSeconds) : 45,
          },
        });
        setShowAiGen(false);
        return;
      }

      // 🟤 Physical Mystery Clues
      if (
        generatedType === (TASK_TYPES.PHYSICAL_MYSTERY_CLUES || "physical-mystery-clues") ||
        generatedType === "physical-mystery-clues"
      ) {
        setTaskConfig({
          prompt: baseTask.prompt || "",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 120,
          clues: Array.isArray(baseTask.clues) ? baseTask.clues : [],
          solution: baseTask.solution || baseTask.answer || "",
        });
        setShowAiGen(false);
        return;
      }


      // 🟡 Brain Spark Notes
      if (generatedType === TASK_TYPES.BRAIN_SPARK_NOTES) {
        setTaskConfig({
          prompt: baseTask.prompt || "",
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          bullets: Array.isArray(baseTask.bullets) ? baseTask.bullets : [],
        });
        setShowAiGen(false);
        return;
      }


      // 🟠 GuessWho (Yes/No deduction) – map to quick-launch config
      if (generatedType === TASK_TYPES.GUESS_WHO || generatedType === "guess-who") {
        const secrets =
          Array.isArray(baseTask.secretAnswers) && baseTask.secretAnswers.length
            ? baseTask.secretAnswers
            : baseTask.secretAnswer
            ? [baseTask.secretAnswer]
            : baseTask.secretConcept
            ? [baseTask.secretConcept]
            : baseTask.answer
            ? [baseTask.answer]
            : [];

        setTaskConfig({
          prompt: baseTask.prompt || "",
          secretAnswers: secrets.map((s) => String(s || "").trim()).filter(Boolean),
          category: baseTask.category || baseTask.topic || aiSubject || "Ad-hoc",
          maxGuesses: Number(baseTask.maxGuesses) > 0 ? Number(baseTask.maxGuesses) : 10,
          timeLimitSeconds:
            Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 60,
          points: typeof baseTask.points === "number" ? baseTask.points : 20,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
        });
        setShowAiGen(false);
        return;
      }

      



      // 🟣 FakeOut (Balderdash-style truth vs fake)
      if (generatedType === TASK_TYPES.FAKE_OUT || generatedType === "fake-out" || generatedType === "fakeout") {
        const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
        const rounds =
          Array.isArray(cfg.rounds) && cfg.rounds.length
            ? cfg.rounds
            : Array.isArray(baseTask.rounds) && baseTask.rounds.length
            ? baseTask.rounds
            : [];

        const playerCount =
          Number(cfg.playerCount) > 0
            ? Number(cfg.playerCount)
            : Number(baseTask.playerCount) > 0
            ? Number(baseTask.playerCount)
            : 4;

        const playerNames =
          Array.isArray(cfg.playerNames) && cfg.playerNames.length === playerCount
            ? cfg.playerNames
            : undefined;

        setTaskConfig({
          prompt:
            String(baseTask.prompt || "").trim() ||
            "Fake Out: One player reads aloud; everyone else listens and votes.",
          config: {
            ...(cfg || {}),
            playerCount,
            playerNames,
            rounds,
            perTurnSeconds: Number(cfg.perTurnSeconds) > 0 ? Number(cfg.perTurnSeconds) : 45,
            readerBonusPoints:
              Number(cfg.readerBonusPoints) > 0 ? Number(cfg.readerBonusPoints) : 5,
          },
          timeLimitSeconds:
            Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 90,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: true,
          objectiveScoring: true,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

// 🎴 RolePlay Deck – map to quick-launch config
if (
  generatedType === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck") ||
  generatedType === "role-play-deck" ||
  generatedType === TASK_TYPES.ROLE_PLAY ||
  generatedType === "role-play" ||
  generatedType === "roleplay"
) {
  const cfg = (baseTask && typeof baseTask.config === "object" && baseTask.config) || {};
  const roles =
    Array.isArray(cfg.roles) && cfg.roles.length
      ? cfg.roles
      : Array.isArray(baseTask.roles) && baseTask.roles.length
      ? baseTask.roles
      : [];

  const scenario =
    String(cfg.scenario || baseTask.scenario || baseTask.prompt || "").trim();

  const mode =
    String(cfg.mode || baseTask.mode || "choose").trim() || "choose";

  // Also sync UI fields so teacher can tweak without JSON
  setRolePlayMode(mode);
  setRolePlayScenarioText(scenario);
  // Put roles back into editable text form
  try {
    const rolesText = Array.isArray(roles)
      ? roles
          .map((r) => {
            const n = String(r?.name || "").trim();
            const ro = String(r?.role || "").trim();
            const ch = Array.isArray(r?.characteristics) ? r.characteristics.join(", ") : "";
            return [n, ro, ch].filter(Boolean).join(" | ");
          })
          .join("\n")
      : "";
    setRolePlayRolesText(rolesText);
  } catch {
    // ignore
  }

  const built = buildRolePlayQuickConfig({
    mode,
    scenario,
    rolesText: Array.isArray(roles)
      ? roles
          .map((r) => {
            const n = String(r?.name || "").trim();
            const ro = String(r?.role || "").trim();
            const ch = Array.isArray(r?.characteristics) ? r.characteristics.join(", ") : "";
            return [n, ro, ch].filter(Boolean).join(" | ");
          })
          .join("\n")
      : "",
  });

  setTaskConfig({
    prompt: built.prompt,
    timeLimitSeconds:
      Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : built.timeLimitSeconds,
    config: {
      ...(built.config || {}),
    },
    subject: aiSubject || "Ad-hoc",
    gradeLevel: gradeStr || "",
  });

  setShowAiGen(false);
  return;
}

// 🔁 Echo Chain (oral memory chain)
      if (
  generatedType === TASK_TYPES.WORD_WEAVER_DUEL ||
  generatedType === "word-weaver-duel"
) {
  const phrase = String(
    baseTask?.targetPhrase ??
      baseTask?.phrase ??
      baseTask?.solution ??
      baseTask?.answerPhrase ??
      ""
  ).trim();

  const wb =
    baseTask?.wordBank ??
    baseTask?.words ??
    baseTask?.bank ??
    baseTask?.config?.wordBank ??
    baseTask?.config?.words ??
    baseTask?.config?.bank ??
    null;

  const wordBank = Array.isArray(wb)
    ? wb.map((w) => String(w || "")).map((w) => w.trim()).filter(Boolean)
    : phrase
        ? phrase.split(/\s+/).filter(Boolean)
        : [];

  setTaskConfig({
    prompt:
      baseTask.prompt ||
      baseTask.instructions ||
      "Rebuild the phrase by placing the correct words in order.",
    targetPhrase: phrase,
    wordBank,
    timeLimitSeconds:
      Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 240,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    objectiveScoring: false,
    aiScoringRequired: false,
  });
  setShowAiGen(false);
  return;
}

if (generatedType === TASK_TYPES.ECHO_CHAIN || generatedType === "echo-chain") {
        const seed =
          baseTask.seedTerm ||
          baseTask.startTerm ||
          baseTask.seed ||
          (Array.isArray(baseTask.aiWordBank) && baseTask.aiWordBank[0]) ||
          (Array.isArray(rawWords) && rawWords[0]) ||
          "";

        setTaskConfig({
          prompt: baseTask.prompt || "Repeat the chain aloud and add one related term each turn.",
          seedTerm: String(seed || "").trim(),
          perTurnSeconds:
            Number(baseTask?.config?.perTurnSeconds) > 0
              ? Number(baseTask.config.perTurnSeconds)
              : Number(baseTask.timeLimitSeconds) > 0
              ? Number(baseTask.timeLimitSeconds)
              : 10,
          pointsPerCorrectAdd:
            Number(baseTask?.config?.pointsPerCorrectAdd) > 0
              ? Number(baseTask.config.pointsPerCorrectAdd)
              : 2,
          rotationBonusPoints:
            Number(baseTask?.config?.rotationBonusPoints) > 0
              ? Number(baseTask.config.rotationBonusPoints)
              : 10,
          maxChainLength:
            Number(baseTask?.config?.maxChainLength) > 0
              ? Number(baseTask.config.maxChainLength)
              : 30,
          requireVocabOnly: !!baseTask?.config?.requireVocabOnly,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
        });

        setShowAiGen(false);
        return;
      }

// 🎙️ Narration Synthesize (teach-back / oral narration)
if (
  generatedType === TASK_TYPES.NARRATION_SYNTHESIZE ||
  generatedType === "narration-synthesize"
) {
  const cfg = baseTask?.config && typeof baseTask.config === "object" ? baseTask.config : {};
  const prompts = Array.isArray(cfg.prompts) ? cfg.prompts : Array.isArray(baseTask.prompts) ? baseTask.prompts : [];

  const playerCount =
    Number(cfg.playerCount) > 0
      ? Number(cfg.playerCount)
      : prompts.length > 0
      ? prompts.length
      : 0;

  const perTurnSeconds =
    Number(cfg.perTurnSeconds) >= 0
      ? Number(cfg.perTurnSeconds)
      : Number(baseTask.timeLimitSeconds) > 0
      ? Number(baseTask.timeLimitSeconds)
      : 60;

  const ratingScale =
    cfg.ratingScale && typeof cfg.ratingScale === "object"
      ? cfg.ratingScale
      : { min: 1, max: 5, label: "Clarity / accuracy" };

  setTaskConfig({
    prompt:
      baseTask.prompt ||
      "Take turns narrating these concept prompts to your team. Rate each speaker for clarity/accuracy.",
    subject: aiSubject || "Ad-hoc",
    gradeLevel: gradeStr || "",
    config: {
      playerCount,
      prompts,
      perTurnSeconds,
      ratingScale,
    },
  });

  setShowAiGen(false);
  return;
}


      // 🟪 PRONUNCIATION (speak & get feedback)
      if (generatedType === (TASK_TYPES.PRONUNCIATION || "pronunciation") || String(generatedType).toLowerCase() === "pronunciation") {
        const accentOptions =
          Array.isArray(baseTask.accentOptions) && baseTask.accentOptions.length
            ? baseTask.accentOptions
            : Array.isArray(baseTask.config?.accentOptions) && baseTask.config.accentOptions.length
            ? baseTask.config.accentOptions
            : ["american", "british", "canadian", "neutral"];
        setTaskConfig({
          prompt: baseTask.prompt || "Pronunciation Practice: record yourself saying the target text.",
          referenceText: baseTask.referenceText || baseTask.targetText || baseTask.text || baseTask.prompt || "",
          phonetic: baseTask.phonetic || baseTask.config?.phonetic || "",
          accentOptions,
          targetAccent: baseTask.targetAccent || baseTask.config?.targetAccent || accentOptions[0] || "american",
          language: baseTask.language || baseTask.config?.language || "English",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 0,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: false,
          aiScoringRequired: true,
        });
        setShowAiGen(false);
        return;
      }

      // 🟦 RECORD AUDIO (teacher-reviewed)
      if (generatedType === (TASK_TYPES.RECORD_AUDIO || "record-audio") || String(generatedType).toLowerCase() === "record-audio") {
        setTaskConfig({
          prompt: baseTask.prompt || "Record an oral answer. Your teacher will listen later.",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 0,
          points: typeof baseTask.points === "number" ? baseTask.points : 0,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: false,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

      // 🟨 SPEECH RECOGNITION (AI transcribes + scores)
      if (generatedType === (TASK_TYPES.SPEECH_RECOGNITION || "speech-recognition") || String(generatedType).toLowerCase() === "speech-recognition") {
        setTaskConfig({
          prompt: baseTask.prompt || "Speak your answer clearly. Curriculate will transcribe and score it.",
          referenceText: baseTask.referenceText || baseTask.targetText || baseTask.text || "",
          language: baseTask.language || baseTask.config?.language || "en-US",
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 60,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: false,
          aiScoringRequired: true,
        });
        setShowAiGen(false);
        return;
      }

      // 🟥 TRUE/FALSE TIC-TAC-TOE (objective intra-team duel)
      if (generatedType === (TASK_TYPES.TRUE_FALSE_TICTACTOE || "true-false-tictactoe") || String(generatedType).toLowerCase() === "true-false-tictactoe") {
        const stmts = Array.isArray(baseTask.statements) ? baseTask.statements : Array.isArray(baseTask.config?.statements) ? baseTask.config.statements : [];
        setTaskConfig({
          prompt: baseTask.prompt || "Drag a True/False statement onto the board to claim squares.",
          statements: stmts,
          board: Array.isArray(baseTask.board) && baseTask.board.length === 9 ? baseTask.board : Array(9).fill(null),
          timeLimitSeconds: Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 90,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: true,
          objectiveScoring: true,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

      // 🟩 MULTI-PLAYER FEEDBACK (reflection / no scoring)
      if (generatedType === (TASK_TYPES.MULTI_PLAYER_FEEDBACK || "multi-player-feedback") || String(generatedType).toLowerCase() === "multi-player-feedback") {
        setTaskConfig({
          prompt: baseTask.prompt || "Quick team feedback: rate the session and share one improvement.",
          timeLimitSeconds: 0,
          points: 0,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: false,
          aiScoringRequired: false,
        });
        setShowAiGen(false);
        return;
      }

      // 🟦 MOOD CHECK-IN (non-scored, non-timed, climate)
      if (
        generatedType === (TASK_TYPES.MOOD_CHECKIN || "mood-checkin") ||
        String(generatedType).toLowerCase() === "mood-checkin" ||
        String(generatedType).toLowerCase() === "mood_checkin"
      ) {
        setTaskConfig({
          prompt:
            baseTask.prompt ||
            "Quick mood check-in: each player taps a mood and the team can add an optional note.",
          timeLimitSeconds: 0,
          points: 0,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: false,
          objectiveScoring: false,
          aiScoringRequired: false,
          config: baseTask.config && typeof baseTask.config === "object" ? baseTask.config : {},
        });
        setShowAiGen(false);
        return;
      }

      // 🎯 BRAIN BLITZ (fast-paced category sprint; objective-ish / often timed)
      if (
        generatedType === (TASK_TYPES.BRAIN_BLITZ || "brainblitz") ||
        String(generatedType).toLowerCase() === "brainblitz" ||
        String(generatedType).toLowerCase() === "brain-blitz" ||
        String(generatedType).toLowerCase() === "brain_blitz"
      ) {
        const cfg = baseTask.config && typeof baseTask.config === "object" ? baseTask.config : {};
        setTaskConfig({
          prompt: baseTask.prompt || "Brain Blitz: rapid-fire answers before the timer runs out!",
          timeLimitSeconds:
            Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 60,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: true,
          objectiveScoring: false,
          aiScoringRequired: false,
          // BrainBlitzTask reads from `config` (categories/items/etc.)
          config: cfg,
        });
        setShowAiGen(false);
        return;
      }

      // 🪢 HANGMAN DUEL (intra-team turn-based word solve)
      if (
        generatedType === (TASK_TYPES.HANGMAN_DUEL || "hangman-duel") ||
        String(generatedType).toLowerCase() === "hangman-duel" ||
        String(generatedType).toLowerCase() === "hangman_duel"
      ) {
        const cfg = baseTask.config && typeof baseTask.config === "object" ? baseTask.config : {};
        setTaskConfig({
          prompt: baseTask.prompt || "Solve the mystery word! Take turns choosing letters.",
          timeLimitSeconds:
            Number(baseTask.timeLimitSeconds) > 0 ? Number(baseTask.timeLimitSeconds) : 120,
          points: typeof baseTask.points === "number" ? baseTask.points : 10,
          subject: aiSubject || "Ad-hoc",
          gradeLevel: gradeStr || "",
          interTeamEnabled: false,
          intraTeamEnabled: true,
          objectiveScoring: true,
          aiScoringRequired: false,
          // HangmanDuelTask expects its gameplay settings under config
          config: cfg,
        });
        setShowAiGen(false);
        return;
      }
      // 🟢 SIMPLE (single-question) CASE
      if (!generatedIsMulti) {
        setTaskConfig({
          __rawTask: baseTask,
          __generatedAt: Date.now(),
          ...baseTask,
          taskType: generatedType,
          prompt: baseTask.prompt || "",
          // Keep correctAnswer only when it exists (objective-scored types)
          correctAnswer:
            baseTask.correctAnswer != null
              ? baseTask.correctAnswer
              : baseTask.answer != null
              ? baseTask.answer
              : baseTask.correct != null
              ? baseTask.correct
              : null,
          options:
            Array.isArray(baseTask.options) && baseTask.options.length > 0
              ? baseTask.options
              : Array.isArray(baseTask.choices) && baseTask.choices.length > 0
              ? baseTask.choices
              : [],
          clue: baseTask.clue || "",
          subject: baseTask.subject || aiSubject || "Ad-hoc",
          gradeLevel: baseTask.gradeLevel || gradeStr || "",
        });

        setShowAiGen(false);
        return;
      }

      // 🟣 MULTI-ITEM CASE – build a 3–5 question pack where possible
      const MAX_ITEMS = 5;

      let itemsSource = [];
      if (Array.isArray(baseTask.items) && baseTask.items.length > 0) {
        itemsSource = baseTask.items;
      } else {
        itemsSource = tasks;
      }

      const items = itemsSource
        .slice(0, MAX_ITEMS)
        .map((t, idx) => ({
          id: t.id ?? t._id ?? String(idx),
          prompt: t.prompt || t.question || "",
          options:
            Array.isArray(t.options) && t.options.length > 0
              ? t.options
              : Array.isArray(t.choices)
              ? t.choices
              : [],
          correctAnswer: t.correctAnswer ?? t.answer ?? t.correct ?? null,
        }))
        .filter((it) => it.prompt && it.prompt.trim().length > 0);

      if (!items.length) {
        throw new Error(
          "AI returned tasks but none had a usable prompt."
        );
      }

      setTaskConfig({
        __rawTask: baseTask,
        __generatedAt: Date.now(),
        ...baseTask,
        taskType: generatedType,
        prompt:
          taskset.description ||
          baseTask.prompt ||
          `Answer all ${items.length} questions.`,
        // normalize commonly-used fields for the quick-launch editor
        correctAnswer: baseTask.correctAnswer ?? baseTask.answer ?? baseTask.correct ?? null,
        options:
          Array.isArray(baseTask.options) && baseTask.options.length > 0
            ? baseTask.options
            : Array.isArray(items[0].options) && items[0].options.length > 0
            ? items[0].options
            : [],
        items,
        subject: baseTask.subject || aiSubject || "Ad-hoc",
        gradeLevel: baseTask.gradeLevel || gradeStr || "",
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

    setTasksetLaunchAnimating(true);
    setTasksetLaunchProgress(8);

    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : null;

    setLaunchingTaskset(true);
    setStatus("Preparing taskset…");
    setTasksetLaunchProgress(20);

    try {
      const res = await fetch(
        `${API_BASE}/api/tasksets/${activeTasksetMeta._id}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          "Server returned invalid JSON while loading set for launch"
        );
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load taskset before launch");
      }

      const tasks = Array.isArray(data.tasks) ? data.tasks : [];

      // ── At-desk-only taskset → default the per-session "On-screen only"
      //   checkbox to true. The teacher built this set explicitly for
      //   seats-only play; honor that intent at launch time.
      if (data?.atDeskOnly === true && !onScreenOnly) {
        setOnScreenOnly(true);
      }
      const effectiveOnScreenOnly = onScreenOnly || data?.atDeskOnly === true;

      // ── Fixed-station setup checklist ──
      // If this taskset has displays (physical objects at stations), show
      // a setup checklist so the teacher can confirm everything is in place.
      const displays = Array.isArray(data.displays) ? data.displays.filter((d) => d && d.name) : [];
      if (displays.length > 0) {
        setStationChecklistDisplays(displays);
        setStationChecklistChecked({});
        setPendingStationTaskset({ data, roomCode: code });
        setShowStationChecklist(true);
        setStatus("Confirm station setup before launching.");
        setLaunchingTaskset(false);
        setTasksetLaunchAnimating(false);
        setTasksetLaunchProgress(0);
        return;
      }

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
        setTasksetLaunchAnimating(false);
        setTasksetLaunchProgress(0);
        return;
      }

      const isPreArmed = autoStartMode !== "immediate";

      if (isPreArmed) {
        setStatus("Taskset armed — waiting for students…");
        setTasksetArmed(true);
        setLaunchAfterLoad(false); // do NOT auto-launch on tasksetLoaded
      } else {
        setStatus("Loading taskset…");
        setLaunchAfterLoad(true);
      }
      setTasksetLaunchProgress(70);

      socket.emit("teacher:loadTaskset", {
        roomCode: code,
        tasksetId: data._id || activeTasksetMeta._id,
        selectedRooms,
        navigationMode,
        mysteryTimerMinutes: navigationMode === "mystery" ? mysteryTimerMinutes : undefined,
        classRosterId: selectedClassRosterId || undefined,
        // Per-session "no walking / no scanning" mode — backend filters
        // out movement-required tasks from the loaded taskset.
        // (Auto-defaulted to true when the taskset was built atDeskOnly.)
        onScreenOnly: effectiveOnScreenOnly,
        duelsEnabled, // per-session duels toggle (runtime trigger, not content)
        reportOwnerId,
        reportOwnerName,
        reportOwnerEmail,
        runByPresenterId: user?.userId || user?.id || user?._id,
        runByPresenterName: runByName,
        runByPresenterEmail: user?.email,
        sharedToken,
        // Auto-start config for pre-armed mode
        ...(isPreArmed && {
          autoStartMode,
          autoStartTimerSeconds: autoStartMode === "timer" ? autoStartTimerMinutes * 60 : undefined,
          autoStartMinTeams: autoStartMode === "all_ready" ? autoStartMinTeams : undefined,
        }),
      });
    } catch (err) {
      console.error("[LiveSession] Launch taskset error:", err);
      setStatus(err.message || "Failed to launch taskset.");
      setTasksetLaunchAnimating(false);
      setTasksetLaunchProgress(0);
    } finally {
      setLaunchingTaskset(false);
    }
  };

  const handleEndSessionAndEmail = () => {
    if (!roomCode || isEndingSession) return;

    const code = roomCode.toUpperCase();
    setIsEndingSession(true);
    setReportProgress({ step: 0, total: 6, label: "Starting report generation…" });
    setEndSessionMessage("");
    setEndSessionIsError(false);

    // Resolve teacher email — try multiple sources
    const resolvedEmail = reportOwnerEmail || user?.email || "";
    const resolvedOwnerId = reportOwnerId || user?.userId || user?.id || user?._id || "";

    console.log("[LiveSession] endSessionAndEmail — ownerId:", resolvedOwnerId, "email:", resolvedEmail);

    socket.emit("teacher:endSessionAndEmail", {
      roomCode: code,
      ownerId: resolvedOwnerId,
      teacherEmail: resolvedEmail,
      includeIndividualReports,
      assessmentCategories: teacherAssessmentCategories,
    });

    // Safety timeout: if the backend never responds, unlock after 90s
    // (AI summary can take 20-30s, plus DB save + email)
    setTimeout(() => {
      setIsEndingSession((prev) => {
        if (prev) {
          setEndSessionMessage("Report generation timed out. Check your email — it may still arrive.");
          setEndSessionIsError(true);
          setReportProgress(null);
        }
        return false;
      });
    }, 90000);
  };

  const handleGiveTreat = () => {
    if (!roomCode || !canGiveTreat) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:giveTreat", { roomCode: code });
  };

  const sendBehaviorDing = (positive) => {
    if (!roomCode || !dingPopup?.teamId) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:behaviorDing", {
      roomCode: code,
      teamId: dingPopup.teamId,
      delta: positive ? DING_AMOUNT : -DING_AMOUNT,
      reason: dingReason.trim() || (positive ? "Good behavior" : "Behavior warning"),
    });
    setDingPopup(null);
    setDingReason("");
  };

  const handleBumpTeam = () => {
    if (!roomCode || !dingPopup?.teamId) return;
    const name = dingPopup.teamName || "this team";
    if (!window.confirm(`Remove "${name}" from this session? They will be disconnected and cannot rejoin.`)) return;
    const code = roomCode.toUpperCase();
    socket.emit("teacher:bumpTeam", {
      roomCode: code,
      teamId: dingPopup.teamId,
      reason: dingReason.trim() || "Inappropriate team name",
    });
    setDingPopup(null);
    setDingReason("");
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
    try { localStorage.setItem("curriculate.teacher.noiseEnabled", String(nextEnabled)); } catch {}
  };

  const handleNoiseThresholdChange = (e) => {
    const value = Number(e.target.value) || 0;
    setNoiseThreshold(value);
    try { localStorage.setItem("curriculate.teacher.noiseThreshold", String(value)); } catch {}
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

  // --- What Am I? teacher controls ---
  // Used by the floating panel below the main UI when the active task is "what-am-i".
  const [whatAmIFrozen, setWhatAmIFrozen] = React.useState(false);
  const handleWhatAmITeacherReveal = () => {
    if (!roomCode || !socket) return;
    const code = roomCode.toUpperCase();
    const idx =
      typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
        ? roomState.taskIndex
        : 0;
    socket.emit("whatAmI:teacherReveal", { roomCode: code, taskIndex: idx }, (resp) => {
      if (resp && resp.ok) {
        setStatus(`What Am I?: revealed clue ${resp.newLevel} (ceiling now ${resp.pointCeiling} pts).`);
      } else if (resp?.atMax) {
        setStatus("What Am I?: all clues already revealed.");
      } else if (resp?.error) {
        setStatus(`What Am I?: ${resp.error}`);
      }
    });
  };
  const handleWhatAmIToggleFreeze = () => {
    if (!roomCode || !socket) return;
    const code = roomCode.toUpperCase();
    const idx =
      typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
        ? roomState.taskIndex
        : 0;
    const next = !whatAmIFrozen;
    socket.emit("whatAmI:teacherFreeze", { roomCode: code, taskIndex: idx, frozen: next }, (resp) => {
      if (resp && resp.ok) {
        setWhatAmIFrozen(!!resp.frozen);
        setStatus(`What Am I? ${resp.frozen ? "frozen" : "unfrozen"}.`);
      } else if (resp?.error) {
        setStatus(`What Am I?: ${resp.error}`);
      }
    });
  };
  // Reset the freeze indicator when we switch tasks
  React.useEffect(() => {
    setWhatAmIFrozen(false);
  }, [roomState.taskIndex]);

  // --- Whodunnit teacher controls ---
  const [mysteryActive, setMysteryActive] = React.useState(false);
  const [mysterySuspect, setMysterySuspect] = React.useState(null);
  const [mysteryClueText, setMysteryClueText] = React.useState("");
  const handleMysteryEnable = () => {
    if (!roomCode || !socket) return;
    socket.emit(
      "mystery:enable",
      { roomCode: roomCode.toUpperCase(), themeRole: "spy", difficulty: "medium" },
      (resp) => {
        if (resp?.ok) {
          setMysteryActive(true);
          setStatus("Whodunnit enabled — a hidden role has been secretly assigned.");
        } else if (resp?.error) {
          setStatus(`Whodunnit: ${resp.error}`);
        }
      },
    );
  };
  const handleMysteryReleaseClue = () => {
    if (!roomCode || !socket || !mysteryClueText.trim()) return;
    socket.emit(
      "mystery:teacherReleaseClue",
      { roomCode: roomCode.toUpperCase(), text: mysteryClueText.trim(), type: "movement" },
      (resp) => {
        if (resp?.ok) {
          setStatus("Whodunnit clue released to all teams.");
          setMysteryClueText("");
        } else if (resp?.error) {
          setStatus(`Whodunnit: ${resp.error}`);
        }
      },
    );
  };
  // Listen for the suspect identity (teacher-only display) — the server broadcasts
  // the identity on enable; the teacher panel uses it but doesn't expose it back to students.
  React.useEffect(() => {
    if (!socket) return;
    const onYouAreSuspect = (msg) => { if (msg?.suspectName) setMysterySuspect(msg.suspectName); };
    const onGameEnded = () => { setMysteryActive(false); setMysterySuspect(null); };
    socket.on("mystery:youAreSuspect", onYouAreSuspect);
    socket.on("mystery:gameEnded", onGameEnded);
    return () => {
      socket.off("mystery:youAreSuspect", onYouAreSuspect);
      socket.off("mystery:gameEnded", onGameEnded);
    };
  }, [socket]);

  // --- Escape Room teacher controls ---
  const isEscapeRoomActive = !!(roomState?.escapeRoomEnabled || activeTasksetMeta?.escapeRoomConfig);
  const handleEscapeGrantKey = (keyId) => {
    if (!roomCode || !socket || !keyId) return;
    socket.emit(
      "escape:teacherGrant",
      { roomCode: roomCode.toUpperCase(), keyId },
      (resp) => {
        if (resp?.ok) setStatus(`Escape: granted key '${keyId}' to all teams.`);
        else if (resp?.error) setStatus(`Escape: ${resp.error}`);
      },
    );
  };
  const escapeRoomKeys = React.useMemo(() => {
    const keys = Array.isArray(activeTasksetMeta?.escapeRoomConfig?.keys) ? activeTasksetMeta.escapeRoomConfig.keys : [];
    return keys.map((k) => ({ id: k.id, name: k.name || k.id }));
  }, [activeTasksetMeta]);

  // Compute whether the current active task is what-am-i (for the floating panel)
  const activeWhatAmITask = React.useMemo(() => {
    const idx =
      typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0
        ? roomState.taskIndex
        : -1;
    if (idx < 0) return null;
    const t = Array.isArray(activeTasksetMeta?.tasks) ? activeTasksetMeta.tasks[idx] : null;
    return t && t.taskType === "what-am-i" ? t : null;
  }, [roomState.taskIndex, activeTasksetMeta]);

  // --- Quest Mode teacher controls ---
  const isQuestModeActive = !!(roomState?.questModeEnabled || activeTasksetMeta?.questModeEnabled);
  const handleQuestGrantAll = () => {
    if (!roomCode || !socket) return;
    socket.emit(
      "quest:teacherGrant",
      { roomCode: roomCode.toUpperCase(), amount: 10 },
      (resp) => {
        if (resp?.ok) {
          setStatus(`Quest: granted 10 coins to ${resp.results?.length || 0} team(s).`);
        } else if (resp?.error) {
          setStatus(`Quest grant error: ${resp.error}`);
        }
      },
    );
  };
  // Find the first bonus / hidden task in the active taskset (if any) for force-unlock
  const questUnlockTargets = React.useMemo(() => {
    const tasks = Array.isArray(activeTasksetMeta?.tasks) ? activeTasksetMeta.tasks : [];
    const bonus = tasks.find((t) => t?.isBonus);
    const hidden = tasks.find((t) => t?.isHidden);
    return {
      bonusId: bonus ? String(bonus.taskId || bonus._id || `idx-${tasks.indexOf(bonus)}`) : null,
      hiddenId: hidden ? String(hidden.taskId || hidden._id || `idx-${tasks.indexOf(hidden)}`) : null,
    };
  }, [activeTasksetMeta]);
  const handleQuestUnlock = (kind) => {
    if (!roomCode || !socket) return;
    const taskId = kind === "bonus" ? questUnlockTargets.bonusId : questUnlockTargets.hiddenId;
    if (!taskId) {
      setStatus(`Quest: no ${kind} task found in this taskset.`);
      return;
    }
    socket.emit(
      "quest:teacherUnlock",
      { roomCode: roomCode.toUpperCase(), taskId, kind },
      (resp) => {
        if (resp?.ok) setStatus(`Quest: unlocked ${kind} task for all teams.`);
        else if (resp?.error) setStatus(`Quest unlock error: ${resp.error}`);
      },
    );
  };

  // ----------------------------------------------------
  // Derived helpers + button state
  // ----------------------------------------------------
  const teams = roomState.teams || {};
  const latestPhotoByTeam = React.useMemo(
        () => buildLatestPhotoByTeam(roomState?.submissions || []),
        [roomState?.submissions]
      );
      
  const teamIdsForGrid = teamOrder.filter((id) => teams[id]);
  const taskFlowActive =
    typeof roomState.taskIndex === "number" && roomState.taskIndex >= 0;

  // Team completion tracking: how many teams finished all tasks + average progress
  const teamCompletionStats = React.useMemo(() => {
    const teamEntries = Object.values(teams);
    const total = teamEntries.length;
    if (total === 0 || !totalTasksInActiveSet || totalTasksInActiveSet <= 0) {
      return { total: 0, completed: 0, pct: 0, avgPct: 0 };
    }
    const completed = teamEntries.filter(
      (t) => typeof t.taskIndex === "number" && t.taskIndex >= totalTasksInActiveSet
    ).length;
    const pct = Math.round((completed / total) * 100);

    // Average progress: use server-computed avgTaskProgress when available,
    // otherwise compute from per-team taskIndex (linear) or mysteryBox teamProgress
    let avgPct = 0;
    if (roomState.avgTaskProgress?.avgPct != null) {
      avgPct = roomState.avgTaskProgress.avgPct;
    } else if (roomState.navigationMode === "mystery" && roomState.mysteryBox?.teamProgress) {
      const tp = roomState.mysteryBox.teamProgress;
      const entries = Object.values(tp);
      if (entries.length > 0) {
        const sum = entries.reduce((s, e) => s + (e.total > 0 ? e.completed / e.total : 0), 0);
        avgPct = Math.round((sum / entries.length) * 100);
      }
    } else {
      // Linear fallback: compute from per-team taskIndex
      let sum = 0, count = 0;
      for (const t of teamEntries) {
        if (typeof t.taskIndex !== "number" || t.taskIndex < 0) continue;
        sum += Math.min(t.taskIndex, totalTasksInActiveSet) / totalTasksInActiveSet;
        count++;
      }
      avgPct = count > 0 ? Math.round((sum / count) * 100) : 0;
    }

    return { total, completed, pct, avgPct };
  }, [teams, totalTasksInActiveSet, roomState.avgTaskProgress, roomState.navigationMode, roomState.mysteryBox]);

  // Auto-end session and generate reports when 100% of teams complete
  React.useEffect(() => {
    if (
      taskFlowActive &&
      teamCompletionStats.total > 0 &&
      teamCompletionStats.pct === 100 &&
      !isEndingSession &&
      !autoEndFiredRef.current
    ) {
      autoEndFiredRef.current = true;
      const timer = setTimeout(() => {
        handleEndSessionAndEmail();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [teamCompletionStats.pct, taskFlowActive, isEndingSession]);

  const isGuessWhoQuick = taskType === TASK_TYPES.GUESS_WHO || taskType === "guess-who";
  const isEchoChainQuick = taskType === TASK_TYPES.ECHO_CHAIN || taskType === "echo-chain";
  const isWordWeaverQuick =
    taskType === TASK_TYPES.WORD_WEAVER_DUEL || taskType === "word-weaver-duel";
  const isFakeOutQuick = taskType === (TASK_TYPES.FAKE_OUT || "fake-out") || taskType === "fake-out" || taskType === "fakeout";
  const isNarrationQuick = taskType === TASK_TYPES.NARRATION_SYNTHESIZE || taskType === "narration-synthesize";
  const isRolePlayQuick =
    taskType === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck") ||
    taskType === "role-play-deck" ||
    taskType === TASK_TYPES.ROLE_PLAY ||
    taskType === "role-play" ||
    taskType === "roleplay";

  const isTicTacToeQuick =
    taskType === (TASK_TYPES.TRUE_FALSE_TICTACTOE || "true-false-tictactoe") ||
    taskType === "true-false-tictactoe" ||
    taskType === "truefalse-tictactoe" ||
    taskType === "true-false-tictactoe-task";

  const isMultiPlayerFeedbackQuick =
    taskType === (TASK_TYPES.MULTI_PLAYER_FEEDBACK || "multi-player-feedback") ||
    taskType === "multi-player-feedback" ||
    taskType === "multiplayer-feedback";

  const isPronunciationQuick =
    taskType === (TASK_TYPES.PRONUNCIATION || "pronunciation") ||
    taskType === "pronunciation";

  const isRecordAudioQuick =
    taskType === (TASK_TYPES.RECORD_AUDIO || "record-audio") ||
    taskType === "record-audio" ||
    taskType === "recordaudio";

  const isSpeechRecognitionQuick =
    taskType === (TASK_TYPES.SPEECH_RECOGNITION || "speech-recognition") ||
    taskType === "speech-recognition" ||
    taskType === "speech-recognition-answer";

  const isReadingCompQuick =
    taskType === (TASK_TYPES.READING_COMP || "reading-comp") ||
    taskType === "reading-comp" ||
    taskType === "reading_comp";

  const quickLaunchReady = isGuessWhoQuick
    ? (Array.isArray(taskConfig.secretAnswers)
        ? taskConfig.secretAnswers
        : taskConfig.secretAnswer
        ? [taskConfig.secretAnswer]
        : [])
        .some((s) => String(s ?? "").trim())
    : isReadingCompQuick
    ? (() => {
        const paragraph = String(
          taskConfig.generatedParagraph || taskConfig.paragraph || taskConfig.text || ""
        ).trim();
        return paragraph.length > 20; // avoid launching empty/too-short paragraphs
      })()
    : isEchoChainQuick
    ? !!String(taskConfig.seedTerm || taskConfig.startTerm || "").trim()
    : isWordWeaverQuick
    ? !!String(
        taskConfig.targetPhrase ||
          taskConfig.phrase ||
          taskConfig.solution ||
          taskConfig.answerPhrase ||
          ""
      ).trim()
    : isFakeOutQuick
    ? (() => {
        const cfg = taskConfig && typeof taskConfig.config === "object" ? taskConfig.config : {};
        const pc = Number(cfg.playerCount);
        const rounds = Array.isArray(cfg.rounds) ? cfg.rounds : [];
        if (!(pc > 0)) return false;
        if (rounds.length === 0) return false;
        return rounds.every((r) => {
          const statement = String(r?.statement ?? "").trim();
          const options = Array.isArray(r?.options) ? r.options : [];
          return statement.length > 0 && options.length >= 4;
        });
      })()

    : isNarrationQuick
    ? (() => {
        const pc = Number(taskConfig?.config?.playerCount);
        const prompts = Array.isArray(taskConfig?.config?.prompts) ? taskConfig.config.prompts : [];
        return pc > 0 && prompts.length === pc;
      })()
    : isRolePlayQuick
    ? (() => {
        const roles = Array.isArray(taskConfig?.config?.roles) ? taskConfig.config.roles : [];
        const scenario = String(taskConfig?.config?.scenario || "").trim();
        return roles.length > 0 && !!scenario;
      })()
    : isTicTacToeQuick
    ? (() => {
        const stmts = Array.isArray(taskConfig.statements) ? taskConfig.statements : [];
        return stmts.length >= 3;
      })()
    : isPronunciationQuick
    ? !!String(taskConfig.referenceText || taskConfig.prompt || "").trim()
    : isSpeechRecognitionQuick
    ? !!String(taskConfig.referenceText || taskConfig.prompt || "").trim()
    : isReadingCompQuick
    ? !!String(taskConfig.generatedParagraph || taskConfig.paragraph || taskConfig.text || "").trim()
    : isRecordAudioQuick
    ? true
    : isMultiPlayerFeedbackQuick
    ? true
    : isOneOfObjectiveSolo(taskType)
    ? (() => {
        const tt = String(taskType || "").toLowerCase();
        if (tt === String(TASK_TYPES.MATCHING || "matching")) {
          const left = Array.isArray(taskConfig.leftItems) ? taskConfig.leftItems : [];
          const right = Array.isArray(taskConfig.rightItems) ? taskConfig.rightItems : [];
          const cm = taskConfig.correctMatches && typeof taskConfig.correctMatches === "object" ? taskConfig.correctMatches : {};
          const pairs = Array.isArray(taskConfig.pairs) ? taskConfig.pairs : [];
          return (
            (left.length >= 3 && right.length >= 3 && Object.keys(cm).length >= 2) ||
            pairs.length >= 3
          );
        }
        if (tt === String(TASK_TYPES.SORT || "sort")) {
          const cats = Array.isArray(taskConfig.categories) ? taskConfig.categories : [];
          const items = Array.isArray(taskConfig.items) ? taskConfig.items : [];
          const map = taskConfig.correctCategoryByItem && typeof taskConfig.correctCategoryByItem === "object"
            ? taskConfig.correctCategoryByItem
            : {};
          return cats.length >= 2 && items.length >= 4 && (Object.keys(map).length >= 3 || items.some((it) => it && (it.category || it.correctCategory)));
        }
        if (tt === String(TASK_TYPES.SEQUENCE || "sequence") || tt === String(TASK_TYPES.TIMELINE || "timeline")) {
          const items = Array.isArray(taskConfig.items) ? taskConfig.items : (Array.isArray(taskConfig.events) ? taskConfig.events : []);
          const order = Array.isArray(taskConfig.correctOrder) ? taskConfig.correctOrder : [];
          return items.length >= 3 && (order.length === items.length || order.length >= 3);
        }
        return false;
      })()
    : !!taskConfig.prompt?.trim();

  // --- Treat gating: require at least 30% of tasks completed ---
  const minTasksBeforeTreat =
    typeof totalTasksInActiveSet === "number" && totalTasksInActiveSet > 0
      ? Math.ceil(totalTasksInActiveSet * 0.3)
      : 0;

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

  // NEW: Mood Check-ins (from MoodCheckinTask) — not scored
  const moodCheckins = roomState?.moodCheckins || {};
  const moodEmojiByKey = {
    super_excited: "😄",
    good: "🙂",
    okay: "😐",
    tired: "😴",
    not_great: "😔",
  };
  const moodLabelByKey = {
    super_excited: "Super excited!",
    good: "Feeling good",
    okay: "Okay",
    tired: "A bit tired",
    not_great: "Not great",
  };


  // NEW: latest submissions list (for right-hand panel)
  const latestSubmissions = Object.values(submissions)
    .sort(
      (a, b) =>
        (b.submittedAt || 0) - (a.submittedAt || 0)
    )
    .slice(0, 8);

  const launchBtnLabelDefault = "Launch from taskset";
  let launchBtnLabel = launchBtnLabelDefault;
  let launchBtnBg = "#10b981";
  let launchBtnOnClick = handleLaunchTaskset;
  let launchBtnDisabled = !activeTasksetMeta;

  if (!activeTasksetMeta) {
    launchBtnDisabled = true;
    launchBtnBg = "#9ca3af";
    launchBtnLabel = launchBtnLabelDefault;
    launchBtnOnClick = null;
  } else if (taskFlowActive && taskAdvancedPause) {
    // Task was force-ended; show "Launch next" so the teacher controls pacing
    launchBtnLabel = "Launch next task";
    launchBtnBg = "#10b981";
    launchBtnOnClick = () => setTaskAdvancedPause(false);
    launchBtnDisabled = false;
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
            <span
              onClick={() => setDingPopup({ teamId, teamName: team.teamName || "Team" })}
              style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
              title="Click to give behavior ding"
            >{team.teamName || "Team"}</span>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "1.25rem",
              }}
            >
              Presenter Console
            </h1>
            <TourHelpButton
              tourId="livesession-v1"
              onClick={() => setShowLiveTour((v) => !v)}
            />
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "#6b7280",
            }}
          >
            Room <strong>{roomCode}</strong> · {status}
          </p>
          {(reportOwnerName || reportOwnerEmail) && (
            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "0.78rem", padding: "4px 10px", borderRadius: 999, background: "#f0f9ff", color: "#0369a1" }}>
                📦 TaskSet from <strong>{reportOwnerName || reportOwnerEmail}</strong>
              </span>
              <span style={{ fontSize: "0.78rem", padding: "4px 10px", borderRadius: 999, background: "#fefce8", color: "#854d0e" }}>
                🧑‍🏫 Presented by <strong>{runByName}</strong>
              </span>
            </div>
          )}
          {/* Report generation progress bar */}
          {isEndingSession && reportProgress && (
            <div style={{ margin: "8px 0 0", maxWidth: 360 }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: reportProgress.error ? "#dc2626"
                  : reportProgress.step >= reportProgress.total ? "#059669" : "#4b5563",
                marginBottom: 3,
              }}>
                <span>{reportProgress.label}</span>
                <span>{reportProgress.step}/{reportProgress.total}</span>
              </div>
              <div style={{
                height: 6,
                borderRadius: 3,
                background: "#e5e7eb",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.round((reportProgress.step / reportProgress.total) * 100)}%`,
                  borderRadius: 3,
                  background: reportProgress.error
                    ? "linear-gradient(90deg, #ef4444, #dc2626)"
                    : reportProgress.step >= reportProgress.total
                      ? "linear-gradient(90deg, #10b981, #059669)"
                      : "linear-gradient(90deg, #6366f1, #4f46e5)",
                  transition: "width 0.4s ease-out",
                }} />
              </div>
            </div>
          )}
          {endSessionMessage && (
            <div
              style={{
                margin: "4px 0 0",
                fontSize: "0.8rem",
                color: endSessionIsError ? "#dc2626" : "#16a34a",
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: endSessionMessage }} />
              {endSessionIsError && !isEndingSession && (
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {savedReportId && (
                    <a
                      href="/reports"
                      style={{
                        padding: "4px 14px",
                        borderRadius: 6,
                        border: "1px solid #2563eb",
                        background: "#eff6ff",
                        color: "#2563eb",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                        textDecoration: "none",
                        cursor: "pointer",
                      }}
                    >
                      View Saved Report
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (savedReportId) {
                        // Just retry email for saved report
                        socket.emit("report:retryEmail", { reportId: savedReportId, roomCode: roomCode?.toUpperCase() });
                        setEndSessionMessage("Retrying email delivery…");
                        setEndSessionIsError(false);
                      } else {
                        autoEndFiredRef.current = false;
                        handleEndSessionAndEmail();
                      }
                    }}
                    style={{
                      padding: "4px 14px",
                      borderRadius: 6,
                      border: "1px solid #dc2626",
                      background: "#fef2f2",
                      color: "#dc2626",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: "pointer",
                    }}
                  >
                    {savedReportId ? "Retry Email Only" : "Retry"}
                  </button>
                </div>
              )}
            </div>
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

      {/* ── Offline / Reconnecting banner ── */}
      {!socketConnected && (
        <div
          style={{
            background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
            color: "#fff",
            textAlign: "center",
            padding: "12px 16px",
            borderRadius: 8,
            fontSize: "0.95rem",
            fontWeight: 700,
            boxShadow: "0 2px 12px rgba(220,38,38,0.3)",
            animation: "offlinePulse 2s ease-in-out infinite",
          }}
        >
          <span style={{ marginRight: 8 }}>📡</span>
          Wi-Fi lost — reconnecting to server…
          <style>{`
            @keyframes offlinePulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
          `}</style>
        </div>
      )}

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

      {/* Main layout */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          minHeight: 0,
          flexDirection: isNarrow ? "column" : "row",
          alignItems: "stretch",
          height: isNarrow ? "auto" : "calc(100vh - 230px)",
          overflow: isNarrow ? "visible" : "hidden",
        }}
      >
        {/* LEFT 1/3: Task controls + Noise/Treats */}
        <div
          style={{
            flex: 1,
            minWidth: isNarrow ? "100%" : 0,
          overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Task controls */}
          <div
            id="live-task-controls"
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

            {/* Quick task */}            {/* Taskset launch + skip */}
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
                {activeTasksetMeta ? (
                  <span style={{ color: "#6b7280" }}>
                    <strong>{activeTasksetName}</strong>
                  </span>
                ) : (
                  <span style={{ color: "#9ca3af" }}>
                    No active taskset selected.
                  </span>
                )}
              </div>

              {/* Auto-start mode picker */}
              {activeTasksetMeta && !taskFlowActive && !tasksetArmed && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", flexWrap: "wrap" }}>
                  <span style={{ color: "#6b7280" }}>Start:</span>
                  {[
                    { value: "immediate", label: "Now" },
                    { value: "first_ready", label: "When 1st team joins" },
                    { value: "all_ready", label: "When all teams join" },
                    { value: "timer", label: "On timer" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAutoStartMode(opt.value)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: autoStartMode === opt.value ? "2px solid #2563eb" : "1px solid #d1d5db",
                        background: autoStartMode === opt.value ? "#eff6ff" : "#fff",
                        color: autoStartMode === opt.value ? "#2563eb" : "#6b7280",
                        fontSize: "0.75rem",
                        fontWeight: autoStartMode === opt.value ? 600 : 400,
                        cursor: "pointer",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {autoStartMode === "timer" && (
                    <select
                      value={autoStartTimerMinutes}
                      onChange={(e) => setAutoStartTimerMinutes(Number(e.target.value))}
                      style={{ fontSize: "0.75rem", padding: "1px 4px", borderRadius: 4 }}
                    >
                      {[1, 2, 3, 5, 10].map((m) => (
                        <option key={m} value={m}>{m} min</option>
                      ))}
                    </select>
                  )}
                  {autoStartMode === "all_ready" && (
                    <select
                      value={autoStartMinTeams}
                      onChange={(e) => setAutoStartMinTeams(Number(e.target.value))}
                      style={{ fontSize: "0.75rem", padding: "1px 4px", borderRadius: 4 }}
                    >
                      {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                        <option key={n} value={n}>{n} teams</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Armed status indicator */}
              {tasksetArmed && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#fef3c7",
                  border: "1px solid #fbbf24",
                  fontSize: "0.8rem",
                  color: "#92400e",
                }}>
                  <span style={{ fontSize: "1rem" }}>&#9201;</span>
                  <span>
                    Taskset armed — waiting for{" "}
                    {autoStartMode === "first_ready" && "first team to join"}
                    {autoStartMode === "all_ready" && `${autoStartMinTeams} teams to join`}
                    {autoStartMode === "timer" && `${autoStartTimerMinutes}min timer`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTasksetArmed(false);
                      setStatus("Auto-start cancelled. Use Launch to start manually.");
                    }}
                    style={{
                      marginLeft: "auto",
                      border: "none",
                      background: "transparent",
                      color: "#92400e",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      textDecoration: "underline",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Class roster binding (Mode B) — pick a class so the join screen
                  shows a name dropdown and the report CSV gets Edsby IDs filled in.
                  On a sub-teacher launch via a class-bound share link, swap the
                  dropdown for a read-only indicator (sub doesn't own the roster). */}
              {activeTasksetMeta && !taskFlowActive && isSharedClassBoundLaunch && (
                <div
                  style={{
                    marginBottom: 6,
                    padding: "6px 8px",
                    background: "#ecfdf5",
                    borderRadius: 8,
                    border: "1px solid #86efac",
                    fontSize: "0.82rem",
                    color: "#065f46",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>📋 Class:</span>{" "}
                  {sharedClassName}
                  <div style={{ marginTop: 2, fontSize: "0.72rem", color: "#047857" }}>
                    Set by the sending teacher. Students will pick their name on join.
                  </div>
                </div>
              )}
              {activeTasksetMeta && !taskFlowActive && !isSharedClassBoundLaunch && isAtLeastPlus && classRosters.length > 0 && (
                <div
                  style={{
                    marginBottom: 6,
                    padding: "6px 8px",
                    background: selectedClassRosterId ? "#ecfdf5" : "transparent",
                    borderRadius: 8,
                    border: selectedClassRosterId ? "1px solid #86efac" : "1px solid transparent",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.82rem",
                      color: "#065f46",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>📋 Class:</span>
                    <select
                      value={selectedClassRosterId}
                      onChange={(e) => setSelectedClassRosterId(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "4px 6px",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        fontSize: "0.82rem",
                        background: "#fff",
                      }}
                    >
                      <option value="">(none — generic launch)</option>
                      {classRosters.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.className || "Unnamed class"} ({r.studentCount || 0} students)
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedClassRosterId && (
                    <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#047857" }}>
                      Students will pick their name on join. Edsby-ready CSV will be in the report.
                    </div>
                  )}
                </div>
              )}

              {/* Navigation mode toggle — Linear vs Mystery Box */}
              {activeTasksetMeta && !taskFlowActive && (
                <div style={{ marginBottom: 6, padding: "6px 8px", background: navigationMode === "mystery" ? "#fdf4ff" : "transparent", borderRadius: 8, border: navigationMode === "mystery" ? "1px solid #e9d5ff" : "1px solid transparent" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setNavigationMode("linear")}
                      style={{
                        flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
                        border: navigationMode === "linear" ? "2px solid #7c3aed" : "1px solid #d1d5db",
                        background: navigationMode === "linear" ? "#f5f3ff" : "#fff",
                        color: navigationMode === "linear" ? "#7c3aed" : "#6b7280",
                        fontWeight: navigationMode === "linear" ? 700 : 400,
                      }}
                    >
                      Linear
                    </button>
                    <button
                      type="button"
                      onClick={() => setNavigationMode("mystery")}
                      style={{
                        flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
                        border: navigationMode === "mystery" ? "2px solid #7c3aed" : "1px solid #d1d5db",
                        background: navigationMode === "mystery" ? "#f5f3ff" : "#fff",
                        color: navigationMode === "mystery" ? "#7c3aed" : "#6b7280",
                        fontWeight: navigationMode === "mystery" ? 700 : 400,
                      }}
                    >
                      Mystery Box
                    </button>
                  </div>
                  {navigationMode === "mystery" && (
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "#6b21a8" }}>
                      <label>Timer:</label>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={mysteryTimerMinutes}
                        onChange={(e) => setMysteryTimerMinutes(Math.max(5, Math.min(90, Number(e.target.value) || 30)))}
                        style={{ width: 48, padding: "2px 4px", borderRadius: 4, border: "1px solid #d8b4fe", textAlign: "center", fontSize: "0.78rem" }}
                      />
                      <span>min</span>
                    </div>
                  )}
                </div>
              )}

              {/* On-screen-only mode (per-session).  Hides movement
                  /scan-required tasks for this session so the class
                  stays at their desks/iPads.  Curriculate's default
                  is up-and-around scavenger-hunt mode; this is the
                  opt-out for a particular lesson. */}
              {activeTasksetMeta && !taskFlowActive && (
                <div
                  style={{
                    marginBottom: 6,
                    padding: "6px 8px",
                    background: onScreenOnly ? "#ecfeff" : "transparent",
                    borderRadius: 8,
                    border: onScreenOnly ? "1px solid #67e8f9" : "1px solid transparent",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={onScreenOnly}
                      onChange={(e) => setOnScreenOnly(e.target.checked)}
                    />
                    🖥️ On-screen only (no scanning, no walking)
                  </label>
                  {onScreenOnly && (
                    <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#0e7490", lineHeight: 1.4 }}>
                      Skipping tasks that need students to leave their
                      seat (Musical Chairs, Mad Dash, Mad Dash Sequence,
                      Station Dash Quiz, Hide &amp; Seek, Treasure
                      Runner).  Everything else runs as normal.
                    </div>
                  )}
                </div>
              )}

              {/* Duels toggle (per-session). Duels are a runtime trigger, not
                  baked-in content, so the teacher opts in here at launch. */}
              {activeTasksetMeta && !taskFlowActive && (
                <div
                  style={{
                    marginBottom: 6,
                    padding: "6px 8px",
                    background: duelsEnabled ? "#fef2f2" : "transparent",
                    borderRadius: 8,
                    border: duelsEnabled ? "1px solid #fca5a5" : "1px solid transparent",
                  }}
                >
                  <label
                    title="A duel is a surprise head-to-head: the system pauses and pits two teams against each other in a quick challenge (e.g. a fast question or word game). The winner earns bonus points, then play resumes. Great for energy; turn off for a calmer session."
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={duelsEnabled}
                      onChange={(e) => setDuelsEnabled(e.target.checked)}
                    />
                    ⚔️ Enable duels (spontaneous head-to-head challenges)
                  </label>
                  {duelsEnabled && (
                    <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#991b1b", lineHeight: 1.4 }}>
                      The system will occasionally pit two teams head-to-head during the
                      session for bonus points. Turn off for a calmer run.
                    </div>
                  )}
                </div>
              )}

              {/* Multi-room scavenger hunt toggle — shown before launch */}
              {activeTasksetMeta && !taskFlowActive && locationOptions.length > 1 && (
                <div style={{ marginBottom: 6, padding: "6px 8px", background: selectedRooms.length > 1 ? "#eff6ff" : "transparent", borderRadius: 8, border: selectedRooms.length > 1 ? "1px solid #bfdbfe" : "1px solid transparent" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selectedRooms.length > 1}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRooms(locationOptions);
                        } else {
                          setSelectedRooms([]);
                        }
                      }}
                    />
                    Multi-room scavenger hunt
                  </label>
                  {selectedRooms.length > 1 && (
                    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {locationOptions.map((loc) => {
                        const active = selectedRooms.includes(loc);
                        return (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => {
                              setSelectedRooms((prev) => {
                                const next = active
                                  ? prev.filter((r) => r !== loc)
                                  : [...prev, loc];
                                return next.length > 1 ? next : prev;
                              });
                            }}
                            style={{
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: active ? "none" : "1px solid #d1d5db",
                              background: active ? "#3b82f6" : "#f9fafb",
                              color: active ? "#fff" : "#6b7280",
                              fontSize: "0.75rem",
                              cursor: "pointer",
                            }}
                          >
                            {loc}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

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
                    background: tasksetLaunchAnimating ? `linear-gradient(90deg, #22c55e 0%, #22c55e ${tasksetLaunchProgress}%, ${launchBtnBg} ${tasksetLaunchProgress}%, ${launchBtnBg} 100%)` : tasksetArmed ? "#f59e0b" : launchBtnBg,
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    cursor: launchBtnDisabled ? "not-allowed" : "pointer",
                    opacity: launchBtnDisabled ? 0.5 : 1,
                  }}
                  disabled={launchBtnDisabled}
                >
                  {tasksetArmed ? "Armed — waiting…" : launchBtnLabel}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={handleSkipTask}
                  disabled={!taskFlowActive || taskAdvancedPause}
                >
                  End task → unlock next
                </button>
                {taskAdvancedPause && (
                  <button
                    type="button"
                    onClick={handleEndSessionAndEmail}
                    disabled={isEndingSession}
                    style={{
                      background: "#dc2626",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: "0.8rem",
                      cursor: isEndingSession ? "not-allowed" : "pointer",
                      opacity: isEndingSession ? 0.5 : 1,
                    }}
                  >
                    End Session & Reports
                  </button>
                )}
              </div>

              {/* Avg progress bar — uses centralized teamCompletionStats.avgPct */}
              {taskFlowActive && teamCompletionStats.total > 0 && (() => {
                const avgPct = teamCompletionStats.avgPct;
                return (
                  <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#374151" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span>Avg progress</span>
                      <span style={{ fontWeight: 600 }}>{avgPct}%</span>
                    </div>
                    <div style={{ width: "100%", height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                      <div style={{
                        width: `${avgPct}%`,
                        height: "100%",
                        borderRadius: 3,
                        background: avgPct === 100 ? "#22c55e" : "#3b82f6",
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: "0.8rem" }}>
            <label>
              Post-submit review time:{" "}
              <select
                value={reviewPauseSeconds}
                onChange={(e) =>
                  setReviewPauseSeconds(
                    parseInt(e.target.value, 10) || 15
                  )
                }
                style={{
                  marginLeft: 4,
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "0.8rem",
                }}
              >
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={20}>20 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={45}>45 seconds</option>
                <option value={60}>60 seconds</option>
              </select>
            </label>
          </div>




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

              {quickLaunchReady ? (
                <>
                  {/* FLASHCARDS Quick Input */}
                  {taskType === TASK_TYPES.FLASHCARDS && (
                    <div style={{ marginTop: 10, marginBottom: 10 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 4,
                          fontSize: "0.8rem",
                          fontWeight: 600,
                        }}
                      >
                        Flashcards (one per line, "term — definition"):
                      </label>

                      <textarea
                        rows={5}
                        placeholder={`Evaporation — water turns into vapour
Condensation — vapour cools
Precipitation — rain, snow, hail`}
                        value={quickFlashcardsText}
                        onChange={(e) =>
                          setQuickFlashcardsText(e.target.value)
                        }
                        style={{
                          width: "100%",
                          padding: 8,
                          borderRadius: 8,
                          border: "1px solid #cbd5e1",
                          fontSize: "0.85rem",
                          background: "#ffffff",
                        }}
                      />
                    </div>
                  )}

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
                  {isGuessWhoQuick && (
                    <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#075985" }}>
                      <strong>Secret concept:</strong>{" "}
                      <span style={{ letterSpacing: 2 }}>••••••</span>
                      <span style={{ marginLeft: 8, color: "#64748b" }}>(hidden)</span>
                      <span style={{ marginLeft: 10, color: "#64748b" }}>
                        max guesses:{" "}
                        {Number(taskConfig.maxGuesses) > 0 ? Number(taskConfig.maxGuesses) : 10}
                        {" · "}
                        timer:{" "}
                        {Number(taskConfig.timeLimitSeconds) > 0 ? Number(taskConfig.timeLimitSeconds) : 60}s
                      </span>
                    </div>
                  )}
                  {isWordWeaverQuick && (
                    <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#075985" }}>
                      <strong>Target phrase:</strong>{" "}
                      {String(
                        taskConfig.targetPhrase ||
                          taskConfig.phrase ||
                          taskConfig.solution ||
                          taskConfig.answerPhrase ||
                          ""
                      ).trim()}
                      <span style={{ marginLeft: 10, color: "#64748b" }}>
                        ({Array.isArray(taskConfig.wordBank) ? taskConfig.wordBank.length : 0} words in bank)
                      </span>
                    </div>
                  )}


                  {isEchoChainQuick && (
                    <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#075985" }}>
                      <strong>Seed term:</strong> {String(taskConfig.seedTerm || taskConfig.startTerm || "").trim() || "(none)"}
                      <span style={{ marginLeft: 10, color: "#64748b" }}>
                        · per-turn timer:{" "}
                        {Number(taskConfig.perTurnSeconds) > 0 ? Number(taskConfig.perTurnSeconds) : 10}s
                        {" · "}
                        rotation bonus:{" "}
                        {Number(taskConfig.rotationBonusPoints) > 0 ? Number(taskConfig.rotationBonusPoints) : 10} pts
                      </span>
                    </div>
                  )}

{isNarrationQuick && (
  <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#075985" }}>
    <strong>Turns:</strong>{" "}
    {Number(taskConfig?.config?.playerCount) > 0
      ? Number(taskConfig.config.playerCount)
      : Array.isArray(taskConfig?.config?.prompts)
      ? taskConfig.config.prompts.length
      : 0}
    <span style={{ marginLeft: 10, color: "#64748b" }}>
      · per-turn timer:{" "}
      {Number(taskConfig?.config?.perTurnSeconds) >= 0
        ? Number(taskConfig.config.perTurnSeconds)
        : 60}
      s
      {" · "}
      scale:{" "}
      {taskConfig?.config?.ratingScale?.min ?? 1}–{taskConfig?.config?.ratingScale?.max ?? 5}
    </span>
    {Array.isArray(taskConfig?.config?.prompts) &&
      taskConfig.config.prompts.length > 0 && (
        <div style={{ marginTop: 6, color: "#334155" }}>
          <div style={{ fontWeight: 800, marginBottom: 2 }}>First prompt:</div>
          <div style={{ fontSize: "0.82rem" }}>
            <span style={{ fontWeight: 700 }}>
              {String(taskConfig.config.prompts[0]?.concept || "").trim() || "Concept"}
              {": "}
            </span>
            <span>{String(taskConfig.config.prompts[0]?.prompt || "").trim()}</span>
          </div>
        </div>
      )}
  </div>
)}

                  {isReadingCompQuick && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: "0.8rem", color: "#075985" }}>
                        <strong>Reading passage:</strong>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #e2e8f0",
                          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                          color: "#0f172a",
                          fontSize: "0.85rem",
                          lineHeight: 1.45,
                          maxHeight: 140,
                          overflow: "auto",
                        }}
                      >
                        {String(
                          taskConfig.generatedParagraph ||
                            taskConfig.paragraph ||
                            taskConfig.text ||
                            ""
                        ).trim() || "(no paragraph set)"}
                      </div>
                      <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#64748b" }}>
                        Intra-team only · AI-scored · each player writes one sentence
                      </div>
                    </div>
                  )}

                  {taskConfig.correctAnswer && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: "0.75rem",
                        color: "#075985",
                      }}
                    >
                      <strong>Correct answer:</strong>{" "}
                      {taskConfig.correctAnswer}
                    </div>
                  )}
                </>
              ) : null}


              {lastQuickTask && (
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: "1px dashed #cbd5e1",
                    fontSize: "0.78rem",
                    color: "#475569",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 2,
                    }}
                  >
                    Last launched quick task
                  </div>
                  <div>{lastQuickTask.prompt}</div>

                  {Array.isArray(lastQuickTask.items) &&
                  lastQuickTask.items.length > 0 ? (
                    <div style={{ marginTop: 4 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.78rem",
                          marginBottom: 2,
                        }}
                      >
                        Answer key
                      </div>
                      <ol
                        style={{
                          paddingLeft: 16,
                          margin: 0,
                          fontSize: "0.78rem",
                          color: "#4b5563",
                        }}
                      >
                        {lastQuickTask.items.map((item, idx) => {
                          const prompt =
                            item.prompt || item.question || `Q${idx + 1}`;

                          const isChoiceType =
                            lastQuickTask.taskType === TASK_TYPES.MULTIPLE_CHOICE ||
                            lastQuickTask.taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE ||
                            lastQuickTask.taskType === TASK_TYPES.TRUE_FALSE;

                          let ansText = "(no correct answer set)";

                          if (
                            item.correctAnswer != null &&
                            String(item.correctAnswer).trim().length > 0
                          ) {
                            if (isChoiceType) {
                              const options = Array.isArray(item.options)
                                ? item.options
                                : Array.isArray(lastQuickTask.options)
                                ? lastQuickTask.options
                                : null;

                              if (
                                options &&
                                typeof item.correctAnswer === "number" &&
                                options[item.correctAnswer] != null
                              ) {
                                // correctAnswer is an index → show that option text
                                ansText = String(options[item.correctAnswer]);
                              } else if (options) {
                                // correctAnswer might be a string that is actually an index
                                const raw = String(item.correctAnswer).trim();
                                const asNum = Number(raw);
                                if (
                                  Number.isFinite(asNum) &&
                                  options[asNum] != null
                                ) {
                                  ansText = String(options[asNum]);
                                } else {
                                  // fall back to raw value
                                  ansText = raw;
                                }
                              } else {
                                ansText = String(item.correctAnswer).trim();
                              }
                            } else {
                              // Non-choice task: just show the value
                              ansText = String(item.correctAnswer).trim();
                            }
                          }

                          return (
                            <li key={item.id || idx} style={{ marginBottom: 2 }}>
                              <span style={{ fontWeight: 500 }}>
                                {prompt}
                                {": "}
                              </span>
                              <span>{ansText}</span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ) : (
                    lastQuickTask.correctAnswer != null &&
                    String(lastQuickTask.correctAnswer).trim().length > 0 && (
                      <div style={{ marginTop: 2 }}>
                        <strong>Answer:</strong>{" "}
                        {(() => {
                          const raw = lastQuickTask.correctAnswer;
                          const baseOptions = Array.isArray(lastQuickTask.options)
                            ? lastQuickTask.options
                            : null;
                          const isChoiceType =
                            lastQuickTask.taskType === TASK_TYPES.MULTIPLE_CHOICE ||
                            lastQuickTask.taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE ||
                            lastQuickTask.taskType === TASK_TYPES.TRUE_FALSE;

                          if (isChoiceType && baseOptions) {
                            // If correctAnswer is an index, map to option text
                            if (
                              typeof raw === "number" &&
                              baseOptions[raw] != null
                            ) {
                              return baseOptions[raw];
                            }
                            const asNum = Number(raw);
                            if (
                              Number.isFinite(asNum) &&
                              baseOptions[asNum] != null
                            ) {
                              return baseOptions[asNum];
                            }
                          }

                          // Fallback: just show the raw value
                          return String(raw).trim();
                        })()}
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Multi-room selector (for special types) */}
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

              {/* Quick task buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setShowAiGen(true)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 999,
                    background: "#7c3aed",
                    color: "white",
                    border: "none",
                    fontSize: "0.9rem",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Generate Quick Task
                </button>

                <button
                  onClick={handleLaunchQuickTask}
                  disabled={!quickLaunchReady}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 999,
                    background: quickLaunchReady ? "#0ea5e9" : "#94a3b8",
                    color: "white",
                    border: "none",
                    fontSize: "0.9rem",
                    fontWeight: 900,
                    cursor: quickLaunchReady ? "pointer" : "not-allowed",
                    opacity: quickLaunchReady ? 1 : 0.75,
                  }}
                >
                  {isLaunchingQuick ? "Launching…" : "Launch Quick Task"}
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
                Print CurricQR Station Sheets
              </button>

              <button
                type="button"
                onClick={handleOpenKiosk}
                disabled={!roomCode}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #d1d5db",
                  background: roomCode ? "#111827" : "#f3f4f6",
                  color: roomCode ? "#ffffff" : "#9ca3af",
                  fontSize: "0.8rem",
                  cursor: roomCode ? "pointer" : "not-allowed",
                }}
              >
                Open Kiosk
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

          {/* Noise & Treats Controls */}
          <div
            id="live-noise-treats"
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
                {/* Noise level meter (live) */}
                <div
                  title={`Noise level: ${Math.round(noiseLevel)} / 100`}
                  style={{
                    width: "100%",
                    height: 8,
                    borderRadius: 4,
                    background: "#e5e7eb",
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, noiseLevel))}%`,
                      height: "100%",
                      background:
                        noiseEnabled && noiseThreshold > 0 && noiseLevel >= noiseThreshold
                          ? "#ef4444"
                          : "#22c55e",
                      transition: "width 120ms linear",
                    }}
                  />
                </div>

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
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: "0.875rem", color: "#374151" }}>
                  Enabled: <strong>{treatsConfig.enabled ? "On" : "Off"}</strong>
                </span>

                <button
                  onClick={() => {
                    const nextEnabled = !treatsConfig.enabled;
                    // Update local state immediately so the UI feels responsive
                    setTreatsConfig((prev) => ({ ...prev, enabled: nextEnabled }));
                    if (!roomCode) return;
                    const code = roomCode.toUpperCase();
                    socket.emit("teacher:updateTreatsConfig", {
                      roomCode: code,
                      enabled: nextEnabled,
                    });
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "none",
                    background: treatsConfig.enabled ? "#22c55e" : "#e5e7eb",
                    color: treatsConfig.enabled ? "white" : "#374151",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {treatsConfig.enabled ? "On" : "Off"}
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={treatsConfig.total}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    // Update local state immediately so the slider feels responsive
                    setTreatsConfig((prev) => ({ ...prev, total: v }));
                    if (!roomCode) return;
                    const code = roomCode.toUpperCase();
                    socket.emit("teacher:updateTreatsConfig", {
                      roomCode: code,
                      totalTreats: v,
                    });
                  }}
                  style={{
                    width: "100%",
                    height: 8,
                    borderRadius: 4,
                    background: "#e5e7eb",
                    outline: "none",
                    appearance: "none",
                  }}
                  aria-label="Treats per session"
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
                  <span>Per session: {treatsConfig.total}</span>
                  <span>Remaining: {Math.max(0, treatsConfig.total - treatsConfig.given)}</span>
                </div>
              </div>


              <p
                style={{
                  margin: "8px 0",
                  fontSize: "0.875rem",
                  color: "#374151",
                }}
              >
                {treatsConfig.enabled ? (
                  <>
                    {treatsConfig.given} of {treatsConfig.total} treats used
                    {treatedTeamIds.size > 0 && (
                      <span style={{ display: "block", fontSize: "0.75rem", color: "#9ca3af", marginTop: 2 }}>
                        {treatedTeamIds.size} team{treatedTeamIds.size !== 1 ? "s" : ""} already treated
                      </span>
                    )}
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
          id="live-teams-grid"
          style={{
            flex: 1,
            minWidth: isNarrow ? "100%" : 0,
          overflow: "hidden",
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
                gridAutoRows: "min-content",
                overflowY: "auto",
                paddingRight: 4,
                minHeight: 120,
                gap: 12,
                width: "100%",
              }}
            >
              {teamIdsForGrid.map((teamId) => renderTeamCard(teamId))}
            </div>
          )}
        </div>

        {/* RIGHT 1/3: Leaderboard + Submissions + Scan log */}
        <div
          id="live-leaderboard"
          style={{
            flex: 1,
            minWidth: isNarrow ? "100%" : 0,
          overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          
          {/* Mood Check-ins (MoodCheckinTask) */}
          {moodCheckins && Object.keys(moodCheckins).length > 0 && (
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
                Mood check-in
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Object.entries(moodCheckins).map(([teamId, checkin]) => {
                  const teamName =
                    teams?.[teamId]?.teamName ||
                    teams?.[teamId]?.name ||
                    "Team";

                  const moodArr = Array.isArray(checkin?.moods)
                    ? checkin.moods
                    : [];

                  return (
                    <div
                      key={teamId}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #e5e7eb",
                        background: "#f9fafb",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontWeight: 800 }}>{teamName}</div>
                        {checkin?.submittedAt && (
                          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                            {new Date(checkin.submittedAt).toLocaleTimeString()}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        {moodArr.length === 0 ? (
                          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                            (no selections)
                          </span>
                        ) : (
                          moodArr.map((idx, i) => {
                            const iNum = typeof idx === "number" ? idx : Number(idx);
                            const key =
                              iNum === 0
                                ? "super_excited"
                                : iNum === 1
                                ? "good"
                                : iNum === 2
                                ? "okay"
                                : iNum === 3
                                ? "tired"
                                : iNum === 4
                                ? "not_great"
                                : null;

                            return (
                              <span
                                key={i}
                                title={key ? moodLabelByKey[key] : "Unknown"}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  border: "1px solid #e5e7eb",
                                  background: "#ffffff",
                                  fontSize: "1rem",
                                }}
                              >
                                <span style={{ fontSize: "1.15rem" }}>
                                  {key ? moodEmojiByKey[key] : "❓"}
                                </span>
                                <span style={{ fontSize: "0.8rem", color: "#374151" }}>
                                  Player {i + 1}
                                </span>
                              </span>
                            );
                          })
                        )}
                      </div>

                      {checkin?.excitement && String(checkin.excitement).trim() && (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: "0.85rem",
                            color: "#334155",
                          }}
                        >
                          <span style={{ fontWeight: 800 }}>Excited about:</span>{" "}
                          {String(checkin.excitement).trim()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

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

            {/* Team completion progress bar — average progress across all teams */}
            {taskFlowActive && teamCompletionStats.total > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: teamCompletionStats.avgPct === 100 ? "#059669" : "#4b5563",
                  marginBottom: 4,
                }}>
                  <span>
                    {teamCompletionStats.avgPct === 100
                      ? "All teams finished!"
                      : teamCompletionStats.completed > 0
                      ? `Avg progress: ${teamCompletionStats.avgPct}% · ${teamCompletionStats.completed}/${teamCompletionStats.total} teams done`
                      : `Avg progress: ${teamCompletionStats.avgPct}%`}
                  </span>
                  <span>{teamCompletionStats.avgPct}%</span>
                </div>
                <div style={{
                  height: 8,
                  borderRadius: 4,
                  background: "#e5e7eb",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${teamCompletionStats.avgPct}%`,
                    borderRadius: 4,
                    background: teamCompletionStats.avgPct === 100
                      ? "linear-gradient(90deg, #10b981, #059669)"
                      : "linear-gradient(90deg, #3b82f6, #2563eb)",
                    transition: "width 0.5s ease-out",
                  }} />
                </div>
                {teamCompletionStats.pct === 100 && !isEndingSession && (
                  <div style={{ fontSize: "0.75rem", color: "#059669", marginTop: 4 }}>
                    Auto-generating reports…
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: "0.9rem", color: "#4b5563" }}>
              {leaderboard.length > 0 ? (
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {leaderboard.map((team, idx) => (
                    <li
                      key={team.teamId}
                      style={{
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      {/* Thumbnail */}
                      {latestPhotoByTeam[team.teamId]?.url ? (
                        <img
                          src={latestPhotoByTeam[team.teamId].url}
                          alt="photo submission"
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 8,
                            objectFit: "cover",
                            border: "1px solid rgba(0,0,0,0.12)",
                            flex: "0 0 auto",
                          }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div style={{ width: 34, height: 34, flex: "0 0 auto" }} />
                      )}

                      {/* Rank + Name + Score */}
                      <div style={{ flex: 1 }}>
                        <strong>{idx + 1}.</strong>{" "}
                        {teams[team.teamId]?.teamName || team.name} — {team.score} pts
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No scores yet.</p>
              )}
            </div>
          </section>

          {/* Latest submissions (per-team last, including multi-pack info) */}
          <section
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 12,
              background: "#ffffff",

              // NEW: make Latest Submissions taller + scrollable
              maxHeight: "360px",     // adjust height as needed (300–500px works well)
              overflowY: "auto",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "1.05rem",
                fontWeight: 600,
              }}
            >
              Latest submissions
            </h2>

            {latestSubmissions.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#9ca3af",
                  fontStyle: "italic",
                }}
              >
                No submissions yet.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: "0.8rem",
                  color: "#374151",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {latestSubmissions.map((s) => {
                  const teamName =
                    teams[s.teamId]?.teamName || s.teamName || "Team";
                  const pts =
                    typeof s.points === "number" ? s.points : 0;
                  const correctIcon =
                    s.correct === true
                      ? "✅"
                      : s.correct === false
                      ? "❌"
                      : "☑️";

                  let packSummary = null;
                  if (
                    s.aiScore &&
                    typeof s.aiScore.correctCount === "number" &&
                    typeof s.aiScore.totalItems === "number" &&
                    s.aiScore.totalItems > 0
                  ) {
                    packSummary = `${s.aiScore.correctCount}/${s.aiScore.totalItems} correct`;
                  }

                  const narrationSummary = summarizeNarrationSubmission(s);

                  // Build a display-friendly answer, hiding raw JSON
                  const rawAns = s.answerText || "";
                  const isJsonBlob = rawAns.startsWith("{") || rawAns.startsWith("[");
                  const displayAnswer = isJsonBlob
                    ? (() => {
                        try {
                          const obj = JSON.parse(rawAns);
                          if (obj.type === "physical-multiple-choice" && Array.isArray(obj.answers)) {
                            const right = obj.answers.filter((a) => a?.isCorrect).length;
                            return `PMC: ${right}/${obj.answers.length} correct`;
                          }
                          if (Array.isArray(obj.answers)) {
                            return obj.answers
                              .map((a, i) => {
                                const v = a?.value ?? a?.answer ?? a?.letter ?? `Q${i + 1}`;
                                const m = a?.isCorrect === true ? " ✓" : a?.isCorrect === false ? " ✗" : "";
                                return `${v}${m}`;
                              })
                              .join("; ");
                          }
                          if (obj.answer) return String(obj.answer);
                          return `(${obj.type || "submitted"})`;
                        } catch {
                          return "(submitted)";
                        }
                      })()
                    : rawAns;
                  const trimmedAnswer =
                    displayAnswer.length > 120
                      ? displayAnswer.slice(0, 117) + "…"
                      : displayAnswer;

                  const narrationLine =
                    narrationSummary
                      ? `Narration ratings: ${narrationSummary.avg.toFixed(1)} / ${narrationSummary.max} (${narrationSummary.count} ratings)`
                      : "";
                  return (
                    <div
                      key={`${s.teamId}-${s.taskIndex}`}
                      style={{
                        padding: 6,
                        borderRadius: 8,
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 2,
                        }}
                      >
                        <span>
                          <strong>{teamName}</strong>{" "}
                          <span style={{ marginLeft: 4 }}>{correctIcon}</span>
                        </span>
                        <span>
                          {pts > 0 ? `+${Math.round(pts)} pts` : `${Math.round(pts)} pts`}
                        </span>
                      </div>
                      {packSummary && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#0369a1",
                            marginBottom: 2,
                          }}
                        >
                          {packSummary}
                        </div>
                      )}
                                          {narrationLine && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#0369a1",
                          marginBottom: 4,
                          fontWeight: 700,
                        }}
                      >
                        {narrationLine}
                      </div>
                    )}

{trimmedAnswer && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#4b5563",
                        }}
                      >
                        <div style={{ fontWeight: 500, marginBottom: 1 }}>
                          Submitted answer(s):
                        </div>
                        {trimmedAnswer.split(/; |\n/).map((line, idx) => (
                          <div key={idx}>{line}</div>
                        ))}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            )}
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

      {/* Hide & Seek modal */}
      {/* ── Behavior Ding Popup ── */}
      {dingPopup && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { setDingPopup(null); setDingReason(""); }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 16, padding: 24, width: 320,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)", textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>
              Behavior Ding
            </div>
            <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 16 }}>
              {dingPopup.teamName}
            </div>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={dingReason}
              onChange={(e) => setDingReason(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 10,
                border: "1px solid #d1d5db", fontSize: "0.85rem", marginBottom: 16,
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendBehaviorDing(true);
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => sendBehaviorDing(false)}
                style={{
                  padding: "10px 20px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #ef4444, #dc2626)",
                  color: "#fff", fontWeight: 700, fontSize: "1rem", cursor: "pointer",
                  minWidth: 100,
                }}
              >
                -{DING_AMOUNT}
              </button>
              <button
                onClick={() => sendBehaviorDing(true)}
                style={{
                  padding: "10px 20px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  color: "#fff", fontWeight: 700, fontSize: "1rem", cursor: "pointer",
                  minWidth: 100,
                }}
              >
                +{DING_AMOUNT}
              </button>
            </div>
            <button
              onClick={handleBumpTeam}
              style={{
                marginTop: 14, padding: "8px 16px", borderRadius: 10,
                border: "1px solid #fca5a5", background: "#fff",
                color: "#b91c1c", fontWeight: 700, fontSize: "0.8rem",
                cursor: "pointer", width: "100%",
              }}
            >
              Bump from session
            </button>
          </div>
        </div>
      )}

      {/* ── Fixed-Station Setup Checklist Modal ── */}
      {showStationChecklist && pendingStationTaskset && (
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
            setShowStationChecklist(false);
            setStationChecklistDisplays([]);
            setStationChecklistChecked({});
            setPendingStationTaskset(null);
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: 20,
              maxWidth: 520,
              width: "90%",
              maxHeight: "80vh",
              boxShadow: "0 20px 40px rgba(15,23,42,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
              Station Setup Checklist
            </h2>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#4b5563" }}>
              This taskset uses fixed stations. Please place these items at the correct CurricQR stations before launching.
            </p>

            <div style={{ marginTop: 4, overflowY: "auto", maxHeight: 320, display: "flex", flexDirection: "column", gap: 8 }}>
              {stationChecklistDisplays.map((d, i) => {
                const colorHex = {
                  red: "#ef4444", orange: "#f97316", yellow: "#eab308",
                  green: "#22c55e", blue: "#3b82f6", teal: "#14b8a6",
                  purple: "#8b5cf6", pink: "#ec4899",
                }[(d.stationColor || "").toLowerCase()] || "#9ca3af";
                const isChecked = !!stationChecklistChecked[i];

                return (
                  <label
                    key={d.key || i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `2px solid ${isChecked ? colorHex : "#e5e7eb"}`,
                      background: isChecked ? "#f0fdf4" : "#fafafa",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => setStationChecklistChecked((prev) => ({ ...prev, [i]: !prev[i] }))}
                      style={{ width: 18, height: 18, accentColor: colorHex, flexShrink: 0 }}
                    />
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        background: colorHex,
                        border: "2px solid rgba(0,0,0,0.1)",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                        {d.name || "Unnamed display"}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                        Place at the <strong style={{ color: colorHex }}>{d.stationColor || "?"}</strong> station
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setShowStationChecklist(false);
                  setStationChecklistDisplays([]);
                  setStationChecklistChecked({});
                  setPendingStationTaskset(null);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { data, roomCode: code } = pendingStationTaskset;
                  setShowStationChecklist(false);
                  setStationChecklistDisplays([]);
                  setStationChecklistChecked({});
                  setPendingStationTaskset(null);

                  // Resume the launch flow (respect auto-start mode)
                  const isPreArmed = autoStartMode !== "immediate";
                  if (isPreArmed) {
                    setStatus("Taskset armed — waiting for students…");
                    setTasksetArmed(true);
                    setLaunchAfterLoad(false);
                  } else {
                    setStatus("Loading taskset…");
                    setLaunchAfterLoad(true);
                  }
                  setTasksetLaunchProgress(70);

                  socket.emit("teacher:loadTaskset", {
                    roomCode: code,
                    tasksetId: data._id || activeTasksetMeta?._id,
                    selectedRooms,
                    classRosterId: selectedClassRosterId || undefined,
                    // Per-session at-desk mode — honor the checkbox AND any
                    // atDeskOnly flag persisted on the taskset itself.
                    onScreenOnly: onScreenOnly || data?.atDeskOnly === true,
                    duelsEnabled, // per-session duels toggle (runtime trigger, not content)
                    reportOwnerId,
                    reportOwnerName,
                    reportOwnerEmail,
                    runByPresenterId: user?.userId || user?.id || user?._id,
                    runByPresenterName: runByName,
                    runByPresenterEmail: user?.email,
                    sharedToken,
                    ...(isPreArmed && {
                      autoStartMode,
                      autoStartTimerSeconds: autoStartMode === "timer" ? autoStartTimerMinutes * 60 : undefined,
                      autoStartMinTeams: autoStartMode === "all_ready" ? autoStartMinTeams : undefined,
                    }),
                  });
                }}
                style={{
                  padding: "6px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: Object.keys(stationChecklistChecked).length === stationChecklistDisplays.length
                    && stationChecklistDisplays.every((_, i) => stationChecklistChecked[i])
                    ? "#10b981"
                    : "#f59e0b",
                  color: "#fff",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {Object.keys(stationChecklistChecked).length === stationChecklistDisplays.length
                  && stationChecklistDisplays.every((_, i) => stationChecklistChecked[i])
                  ? "All set — Launch!"
                  : "Launch anyway"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                          ...(token
                            ? { Authorization: `Bearer ${token}` }
                            : {}),
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

                    const codeToUse =
                      pendingHideTaskset.roomCode ||
                      (roomCode ? roomCode.toUpperCase() : null);

                    if (codeToUse) {
                      const isPreArmed = autoStartMode !== "immediate";
                      if (isPreArmed) {
                        setStatus("Taskset armed — waiting for students…");
                        setTasksetArmed(true);
                        setLaunchAfterLoad(false);
                      } else {
                        setStatus("Loading taskset…");
                        setLaunchAfterLoad(true);
                      }
                      socket.emit("teacher:loadTaskset", {
                        roomCode: codeToUse,
                        tasksetId:
                          data._id ||
                          tasksetDoc._id ||
                          activeTasksetMeta?._id,
                        selectedRooms,
                        classRosterId: selectedClassRosterId || undefined,
                        // Per-session at-desk mode — honor checkbox AND
                        // any atDeskOnly flag persisted on the taskset.
                        onScreenOnly:
                          onScreenOnly ||
                          data?.atDeskOnly === true ||
                          tasksetDoc?.atDeskOnly === true,
                        duelsEnabled, // per-session duels toggle (runtime trigger, not content)
                        reportOwnerId,
                        reportOwnerName,
                        reportOwnerEmail,
                        runByPresenterId: user?.userId || user?.id || user?._id,
                        runByPresenterName: runByName,
                        runByPresenterEmail: user?.email,
                        sharedToken,
                        ...(isPreArmed && {
                          autoStartMode,
                          autoStartTimerSeconds: autoStartMode === "timer" ? autoStartTimerMinutes * 60 : undefined,
                          autoStartMinTeams: autoStartMode === "all_ready" ? autoStartMinTeams : undefined,
                        }),
                      });
                    }
                  } catch (err) {
                    console.error(
                      "[LiveSession] Hide & Seek save error:",
                      err
                    );
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
            zIndex: 1000,
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
            <p
              style={{
                margin: "0 0 16px 0",
                color: "#64748b",
                fontSize: "0.9rem",
              }}
            >
              Fill in as much as you want — we will create a perfect task for
              you.
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Task type selection */}
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              >
                {QUICK_TASK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
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

              <div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    marginBottom: 4,
                    color: "#4b5563",
                    fontWeight: 500,
                  }}
                >
                  Learning objective / purpose
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  {PURPOSE_OPTIONS.map((option) => {
                    const selected = aiPurpose === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() =>
                          setAiPurpose(selected ? "" : option)
                        }
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid",
                          borderColor: selected ? "#6366f1" : "#cbd5e1",
                          background: selected ? "#eef2ff" : "#ffffff",
                          fontSize: "0.8rem",
                          color: selected ? "#111827" : "#4b5563",
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>

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

            {/* RolePlay Deck quick-entry (no JSON) */}
            {(taskType === (TASK_TYPES.ROLE_PLAY_DECK || "role-play-deck") ||
              taskType === "role-play-deck" ||
              taskType === TASK_TYPES.ROLE_PLAY ||
              taskType === "role-play" ||
              taskType === "roleplay") && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  🎴 RolePlay Deck quick setup
                </div>
                <div style={{ fontSize: "0.8rem", color: "#475569", marginBottom: 10 }}>
                  Enter a scenario and roles here to launch immediately — or click <strong>Generate Quick Task</strong> to have AI improve/fill it.
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: 4, color: "#334155" }}>
                      Mode
                    </div>
                    <select
                      value={rolePlayMode}
                      onChange={(e) => setRolePlayMode(e.target.value)}
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        background: "white",
                      }}
                    >
                      <option value="choose">Choose on student device</option>
                      <option value="mystery">Mystery (hidden roles)</option>
                      <option value="classic">Classic (open roles)</option>
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: 4, color: "#334155" }}>
                      Suggested time
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b", lineHeight: 1.3 }}>
                      Recommended 3 minutes (180s). You can change this after generation or in the quick preview.
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: 4, color: "#334155" }}>
                    Scenario (what they role-play)
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Example: You are settlers and Mi'kmaq leaders negotiating land use near a new fort. Each role has different goals—work toward a fair agreement."
                    value={rolePlayScenarioText}
                    onChange={(e) => setRolePlayScenarioText(e.target.value)}
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      resize: "vertical",
                      background: "white",
                    }}
                  />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: 4, color: "#334155" }}>
                      Roles (one per line)
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                      Format: <code>Name | Role | traits, traits</code>
                    </div>
                  </div>
                  <textarea
                    rows={5}
                    placeholder={`Alex | Governor | fair, cautious, decisive
Marie | Merchant | persuasive, curious, generous
Thomas | Soldier | loyal, brave, disciplined`}
                    value={rolePlayRolesText}
                    onChange={(e) => setRolePlayRolesText(e.target.value)}
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      resize: "vertical",
                      background: "white",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: "0.82rem",
                    }}
                  />
                  <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#475569" }}>
                    Parsed roles: <strong>{parseRolePlayRolesText(rolePlayRolesText).length}</strong>
                    {parseRolePlayRolesText(rolePlayRolesText).length === 0 && (
                      <span style={{ marginLeft: 8, color: "#b91c1c" }}>
                        · add at least 1 role line
                      </span>
                    )}
                    {String(rolePlayScenarioText || "").trim() === "" && (
                      <span style={{ marginLeft: 8, color: "#b91c1c" }}>
                        · scenario required for Launch
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#64748b" }}>
                  Student view: players draw a card, then the scenario appears and they role-play as a team. No objective scoring.
                </div>
              </div>
            )}

            <div
              style={{
                marginTop: 20,
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
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
                onClick={handleGenerateQuickTask}
                disabled={isGenerating}
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  background: "#4f46e5",
                  color: "white",
                  border: "none",
                  fontWeight: 600,
                  opacity: isGenerating ? 0.7 : 1,
                  cursor: isGenerating ? "wait" : "pointer",
                }}
              >
                {isGenerating ? "Generating…" : "Generate Task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Whodunnit teacher console — only renders when the taskset opts in
          (mysteryEnabled flag) OR the teacher has already enabled mystery
          mode this session. Position is bottom-right so it doesn't collide
          with the left-edge sidebar. Stacks above the What Am I?/Quest
          consoles when those are also visible. */}
      {(roomState?.taskset?.mysteryEnabled === true ||
        roomState?.taskset?.mysteryConfig != null ||
        mysteryActive) && (
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 180,
          zIndex: 99,
          background: "#1f2937",
          color: "#f1f5f9",
          border: "1px solid #475569",
          borderRadius: 12,
          padding: "10px 12px",
          boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
          minWidth: 230,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.5, color: "#c4b5fd" }}>
          🕵 Whodunnit
        </div>
        {!mysteryActive ? (
          <button
            type="button"
            onClick={handleMysteryEnable}
            style={{ padding: "6px 12px", fontSize: "0.8rem", fontWeight: 600, borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", cursor: "pointer" }}
          >
            Enable Whodunnit
          </button>
        ) : (
          <>
            {mysterySuspect ? (
              <div style={{ fontSize: "0.75rem", color: "#fde68a", fontWeight: 600 }}>
                Suspect (teacher-only): {mysterySuspect}
              </div>
            ) : (
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Suspect assigned. Identity stays private to you.</div>
            )}
            <input
              type="text"
              value={mysteryClueText}
              onChange={(e) => setMysteryClueText(e.target.value)}
              placeholder="Release a clue…"
              style={{ padding: "6px 10px", fontSize: "0.8rem", borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "#f1f5f9" }}
            />
            <button
              type="button"
              onClick={handleMysteryReleaseClue}
              disabled={!mysteryClueText.trim()}
              style={{ padding: "5px 10px", fontSize: "0.78rem", fontWeight: 600, borderRadius: 6, border: "none", background: mysteryClueText.trim() ? "#7c3aed" : "rgba(75,85,99,0.5)", color: "#fff", cursor: mysteryClueText.trim() ? "pointer" : "not-allowed" }}
            >
              Release clue
            </button>
          </>
        )}
      </div>
      )}

      {/* Escape Room teacher console — only when active taskset is escape-enabled */}
      {isEscapeRoomActive && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 200,
            zIndex: 99,
            background: "#1f2937",
            color: "#f1f5f9",
            border: "1px solid #fbbf24",
            borderRadius: 12,
            padding: "10px 12px",
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
            minWidth: 230,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.5, color: "#fde68a" }}>
            🔐 Escape Room
          </div>
          <div style={{ fontSize: "0.72rem", color: "#cbd5e1" }}>
            Grant a key to all teams (mercy intervention):
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {escapeRoomKeys.length === 0 ? (
              <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>No keys defined in this taskset.</div>
            ) : (
              escapeRoomKeys.slice(0, 6).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => handleEscapeGrantKey(k.id)}
                  style={{ padding: "4px 10px", fontSize: "0.75rem", fontWeight: 600, borderRadius: 6, border: "1px solid #fbbf24", background: "transparent", color: "#fde68a", cursor: "pointer" }}
                >
                  +{k.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Quest Mode teacher console — only when active taskset is quest-enabled */}
      {isQuestModeActive && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 200,
            zIndex: 99,
            background: "#1f2937",
            color: "#f1f5f9",
            border: "1px solid #7c3aed",
            borderRadius: 12,
            padding: "12px 14px",
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
            minWidth: 240,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: "#c4b5fd",
            }}
          >
            🪙 Quest Mode controls
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleQuestGrantAll}
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "none",
                background: "#fbbf24",
                color: "#1f2937",
                cursor: "pointer",
              }}
            >
              +10 coins (all teams)
            </button>
            <button
              type="button"
              onClick={() => handleQuestUnlock("bonus")}
              disabled={!questUnlockTargets.bonusId}
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid #7c3aed",
                background: questUnlockTargets.bonusId ? "transparent" : "rgba(75,85,99,0.4)",
                color: "#c4b5fd",
                cursor: questUnlockTargets.bonusId ? "pointer" : "not-allowed",
              }}
            >
              Unlock bonus
            </button>
            <button
              type="button"
              onClick={() => handleQuestUnlock("hidden")}
              disabled={!questUnlockTargets.hiddenId}
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid #fbbf24",
                background: questUnlockTargets.hiddenId ? "transparent" : "rgba(75,85,99,0.4)",
                color: "#fde68a",
                cursor: questUnlockTargets.hiddenId ? "pointer" : "not-allowed",
              }}
            >
              Reveal hidden
            </button>
          </div>
        </div>
      )}

      {/* What Am I? teacher control panel — only when active task is what-am-i */}
      {activeWhatAmITask && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 100,
            background: "#1f2937",
            color: "#f1f5f9",
            border: "1px solid #374151",
            borderRadius: 12,
            padding: "12px 14px",
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
            minWidth: 240,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: "#a78bfa",
            }}
          >
            What Am I? controls
          </div>
          <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>
            {activeWhatAmITask.title || "Deduction Challenge"}
            {activeWhatAmITask?.config?.mode ? (
              <span style={{ opacity: 0.7, marginLeft: 6, fontSize: "0.75rem" }}>
                · {activeWhatAmITask.config.mode}
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleWhatAmITeacherReveal}
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "none",
                background: "#7c3aed",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Reveal next clue (all teams)
            </button>
            <button
              type="button"
              onClick={handleWhatAmIToggleFreeze}
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid #6b7280",
                background: whatAmIFrozen ? "#fbbf24" : "transparent",
                color: whatAmIFrozen ? "#1f2937" : "#f1f5f9",
                cursor: "pointer",
              }}
            >
              {whatAmIFrozen ? "Unfreeze" : "Freeze submissions"}
            </button>
          </div>
        </div>
      )}

      {/* Spotlight tour for LiveSession */}
      <SpotlightTour
        tourId="livesession-v1"
        steps={[
          {
            target: "#live-task-controls",
            title: "Task Controls",
            body: "Load a pre-built task set, launch quick AI tasks, or skip to the next task. This is your main control panel.",
          },
          {
            target: "#live-teams-grid",
            title: "Teams",
            body: "Teams appear here as students scan CurricQR codes and join. You'll see their status, current task, and connection state.",
          },
          {
            target: "#live-leaderboard",
            title: "Leaderboard & Submissions",
            body: "Scores update in real time. You can also see individual submissions and a scan log of CurricQR activity.",
          },
          {
            target: "#live-noise-treats",
            title: "Noise & Treats",
            body: "Use Noise Control to dim screens when it's too loud. Award treats for good behavior — they appear on student devices.",
          },
        ]}
        forceShow={showLiveTour}
        onComplete={() => setShowLiveTour(false)}
      />
    </div>
  );
}
