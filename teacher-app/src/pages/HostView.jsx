// teacher-app/src/pages/HostView.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { socket } from "../socket";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { Trophy, Camera, Users, Sparkles, Volume2, VolumeX, Zap } from "lucide-react";

// ── Constants ────────────────────────────────────────────────
const trophyEmojis = ["🥇", "🥈", "🥉"];
const podiumColors = [
  "bg-gradient-to-b from-cyan-400 to-blue-600 shadow-cyan-500/50",
  "bg-gradient-to-b from-yellow-300 to-amber-500 shadow-yellow-400/50",
  "bg-gradient-to-b from-pink-400 to-rose-600 shadow-pink-500/50",
];

const PHOTO_TASK_TYPES = new Set([
  "photo-task", "phototask", "photo", "photojournal",
  "photo-journal", "photoJournal", "PhotoTask", "PhotoJournal",
]);

// ── Sounds (local files — instant load) ──────────────────────
const SFX = {
  teamJoin:  "/sounds/yay.mp3",
  correct:   "/sounds/correct.mp3",
  wrong:     "/sounds/wrong.mp3",
  cheer:     "/sounds/victory.mp3",
  ding:      "/sounds/ding.mp3",
  powerUp:   "/sounds/power-up.mp3",
};

// ── Aurora backdrop ──────────────────────────────────────────
const AURORA_OVERLAY_STYLE = {
  backgroundImage: `
    radial-gradient(900px circle at 15% 20%, rgba(255,255,255,0.14), transparent 60%),
    radial-gradient(800px circle at 80% 28%, rgba(34,211,238,0.16), transparent 55%),
    radial-gradient(950px circle at 45% 90%, rgba(168,85,247,0.14), transparent 60%),
    linear-gradient(120deg, rgba(255,255,255,0.06), transparent 35%, rgba(255,255,255,0.04)),
    repeating-linear-gradient(0deg, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 1px, transparent 1px, transparent 4px)
  `,
};

function AuroraBackdrop() {
  return (
    <>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -top-36 -left-36 w-[520px] h-[520px] rounded-full blur-3xl opacity-35 bg-pink-400"
        animate={{ x: [0, 24, 0], y: [0, -18, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute top-10 -right-40 w-[560px] h-[560px] rounded-full blur-3xl opacity-30 bg-cyan-300"
        animate={{ x: [0, -18, 0], y: [0, 22, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-52 left-1/3 w-[640px] h-[640px] rounded-full blur-3xl opacity-25 bg-purple-400"
        animate={{ x: [0, 16, 0], y: [0, 14, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay"
        style={AURORA_OVERLAY_STYLE}
      />
    </>
  );
}

// ── Animated score counter ───────────────────────────────────
function AnimatedPts({ value = 0, className = "" }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    if (from === to) return;

    setPulse(true);
    const pulseTimer = setTimeout(() => setPulse(false), 500);
    const startTime = performance.now();
    const diff = to - from;
    const duration = Math.min(800, Math.max(300, Math.abs(diff) * 4));

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + diff * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      clearTimeout(pulseTimer);
    };
  }, [value]);

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        transition: "transform 0.2s cubic-bezier(.34,1.56,.64,1)",
        transform: pulse ? "scale(1.3)" : "scale(1)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {display}
    </span>
  );
}

// ── Live score pop-up notification ───────────────────────────
function ScorePopup({ teamName, points, speedBonus, correct, id }) {
  const isPositive = points > 0;
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 40, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -60, scale: 0.5 }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      className="pointer-events-none"
      style={{
        padding: "12px 24px",
        borderRadius: 18,
        fontWeight: 900,
        fontSize: points >= 80 ? "1.6rem" : "1.3rem",
        color: "#fff",
        background: isPositive
          ? "linear-gradient(135deg, #10b981, #059669)"
          : "linear-gradient(135deg, #ef4444, #dc2626)",
        boxShadow: isPositive
          ? "0 6px 30px rgba(16,185,129,0.5)"
          : "0 6px 30px rgba(239,68,68,0.5)",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ marginRight: 8 }}>{teamName}</span>
      <span style={{ fontSize: "1.8em", verticalAlign: "middle" }}>
        {isPositive ? "+" : ""}{Math.round(points)}
      </span>
      {speedBonus > 0 && (
        <span style={{ fontSize: "0.75em", marginLeft: 8, opacity: 0.9 }}>
          (+{Math.round(speedBonus)} speed)
        </span>
      )}
    </motion.div>
  );
}

// ── Helpers ──────────────────────────────────────────────────
function pickPhotoUrl(sub) {
  return (
    sub?.photoUrl || sub?.imageUrl || sub?.fileUrl || sub?.mediaUrl ||
    sub?.data?.photoUrl || sub?.data?.imageUrl || sub?.data?.fileUrl || sub?.data?.mediaUrl ||
    (Array.isArray(sub?.photos) ? sub.photos[0] : null) ||
    (Array.isArray(sub?.data?.photos) ? sub.data.photos[0] : null) ||
    null
  );
}

function buildLatestPhotoByTeam(submissions = []) {
  const out = {};
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

// ══════════════════════════════════════════════════════════════
// HostView — the projected game-show screen students see
// ══════════════════════════════════════════════════════════════
export default function HostView({ roomCode: roomCodeProp }) {
  const location = useLocation();
  const qs = new URLSearchParams(location.search || "");
  const roomFromQuery = (qs.get("room") || "").trim().toUpperCase();
  const sharedToken = (qs.get("sharedToken") || qs.get("token") || "").trim();
  const reportOwnerName = (qs.get("reportOwnerName") || qs.get("from") || "").trim();

  const roomCode = roomFromQuery || (roomCodeProp || "").trim().toUpperCase();

  const [roomState, setRoomState] = useState({
    teams: {},
    scores: {},
    playerScores: [],
    submissions: [],
    taskIndex: -1,
    totalTasks: 0,
    tasksetName: "",
    locationCode: "Classroom",
    isActive: false,
    moodCheckins: {},
  });

  const [activeTab, setActiveTab] = useState("leaderboard");
  const [showConfetti, setShowConfetti] = useState(false);
  const [taskEndCelebration, setTaskEndCelebration] = useState(false); // true when task just ended
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scorePopups, setScorePopups] = useState([]);
  const popupIdRef = useRef(0);

  // Delete team modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTeamId, setDeleteTeamId] = useState(null);

  // Sound refs
  const soundRefs = useRef({});

  const openDeleteTeamModal = (teamId) => {
    if (!teamId) return;
    setDeleteTeamId(teamId);
    setDeleteModalOpen(true);
  };

  const closeDeleteTeamModal = () => {
    setDeleteModalOpen(false);
    setDeleteTeamId(null);
  };

  const kickTeam = () => {
    if (!deleteTeamId) return;
    socket.emit("team:kick", { roomCode: String(roomCode || "").toUpperCase().trim(), teamId: deleteTeamId });
    closeDeleteTeamModal();
  };

  // ── Sound system ─────────────────────────────────────────
  useEffect(() => {
    for (const [key, src] of Object.entries(SFX)) {
      try {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = key === "cheer" ? 0.5 : 0.6;
        soundRefs.current[key] = audio;
      } catch {
        soundRefs.current[key] = null;
      }
    }

    const handleResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const playSound = useCallback((key) => {
    if (!soundEnabled) return;
    try {
      const audio = soundRefs.current[key];
      if (!audio) return;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {}
  }, [soundEnabled]);

  // ── Add a score popup ────────────────────────────────────
  const addScorePopup = useCallback((teamName, points, speedBonus = 0, correct = null) => {
    const id = ++popupIdRef.current;
    setScorePopups((prev) => [...prev.slice(-4), { id, teamName, points, speedBonus, correct }]);
    setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== id));
    }, 3000);
  }, []);

  // ── Socket events ────────────────────────────────────────
  useEffect(() => {
    if (!roomCode) return;
    const code = String(roomCode).toUpperCase().trim();

    socket.emit("joinRoom", { roomCode: code, role: "host", name: "Host" });

    const handleRoom = (state) => {
      const safe = state || {};
      setRoomState((prev) => ({
        ...prev,
        teams: safe.teams || {},
        scores: safe.scores || {},
        playerScores: Array.isArray(safe.playerScores) ? safe.playerScores : prev.playerScores || [],
        submissions: Array.isArray(safe.submissions) ? safe.submissions : prev.submissions || [],
        taskIndex: typeof safe.taskIndex === "number" ? safe.taskIndex : prev.taskIndex,
        totalTasks: typeof safe.totalTasks === "number" ? safe.totalTasks : prev.totalTasks,
        tasksetName: safe.tasksetName || safe.taskset?.name || prev.tasksetName || "",
        locationCode: safe.locationCode || prev.locationCode || "Classroom",
        isActive: safe.isActive ?? prev.isActive,
        moodCheckins: safe.moodCheckins && typeof safe.moodCheckins === "object" ? safe.moodCheckins : prev.moodCheckins || {},
      }));
    };

    const handleTeamJoined = (data) => {
      playSound("teamJoin");
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2500);
    };

    // Listen to individual task submissions for live pop-ups
    const handleTaskSubmission = (data) => {
      if (!data) return;
      const teamName = data.teamName || "Team";
      const pts = typeof data.points === "number" ? data.points : 0;
      const speedBonus = typeof data.speedBonus === "number" ? data.speedBonus : 0;
      const correct = data.correct;

      if (pts > 0) {
        playSound(pts >= 80 ? "powerUp" : "correct");
        addScorePopup(teamName, pts, speedBonus, correct);
        if (pts >= 100) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 1800);
        }
      } else if (correct === false) {
        playSound("wrong");
      }
    };

    const handleEnded = () => {
      playSound("cheer");
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 8000);
    };

    const handleMoodUpdate = (data) => {
      if (!data) return;
      setRoomState((prev) => ({
        ...prev,
        moodCheckins: {
          ...prev.moodCheckins,
          [data.teamId]: data,
        },
      }));
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("teamJoined", handleTeamJoined);
    socket.on("team:joined", handleTeamJoined);
    socket.on("taskSubmission", handleTaskSubmission);
    socket.on("session-ended", handleEnded);
    socket.on("mood-checkin:update", handleMoodUpdate);

    // Task force-advanced or auto-advanced → celebrate winner with confetti
    const handleTaskAdvance = (payload) => {
      playSound("cheer");
      setShowConfetti(true);
      setTaskEndCelebration(true);
      setTimeout(() => setShowConfetti(false), 6000);
      // Keep "Winner" label visible for 10s
      setTimeout(() => setTaskEndCelebration(false), 10000);
    };
    socket.on("task:advance", handleTaskAdvance);

    socket.emit("room:request-state", { roomCode: code });

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("team:joined", handleTeamJoined);
      socket.off("taskSubmission", handleTaskSubmission);
      socket.off("session-ended", handleEnded);
      socket.off("mood-checkin:update", handleMoodUpdate);
      socket.off("task:advance", handleTaskAdvance);
    };
  }, [roomCode, playSound, addScorePopup]);

  const codeUpper = useMemo(
    () => String(roomCode || "").toUpperCase().trim(),
    [roomCode]
  );

  const latestPhotos = useMemo(
    () => buildLatestPhotoByTeam(roomState.submissions),
    [roomState.submissions]
  );

  const leaderboard = useMemo(() => {
    const teamsObj = roomState.teams || {};
    const scoresObj = roomState.scores || {};
    return Object.values(teamsObj)
      .map((t) => ({
        teamId: t.id || t.teamId || t._id,
        name: t.teamName || t.name || "Team",
        pts: scoresObj[t.id || t.teamId || t._id] || 0,
        thumb: latestPhotos[t.id || t.teamId || t._id]?.url || null,
      }))
      .filter((r) => !!r.teamId)
      .sort((a, b) => b.pts - a.pts);
  }, [roomState.teams, roomState.scores, latestPhotos]);

  const topThree = useMemo(() => leaderboard.slice(0, 3), [leaderboard]);
  const displayOrder = [1, 0, 2]; // 2nd, 1st, 3rd for podium

  // Top 3 individual players
  const topPlayers = useMemo(() => {
    const ps = roomState.playerScores || [];
    return ps.slice(0, 3); // already sorted desc by backend
  }, [roomState.playerScores]);

  // Mood summary
  const MOOD_EMOJIS = ["😄", "🙂", "😐", "😴", "😔"];
  const MOOD_LABELS = ["Super excited", "Feeling good", "Okay", "A bit tired", "Not great"];
  const moodSummary = useMemo(() => {
    const checkins = roomState.moodCheckins || {};
    const entries = Object.values(checkins);
    if (entries.length === 0) return null;
    // Flatten all mood indices from all teams
    const allMoods = entries.flatMap((e) => Array.isArray(e.moods) ? e.moods : []);
    if (allMoods.length === 0) return null;
    // Count per mood index
    const counts = [0, 0, 0, 0, 0];
    for (const m of allMoods) {
      if (typeof m === "number" && m >= 0 && m <= 4) counts[m]++;
    }
    // Find dominant mood
    let topIdx = 0;
    for (let i = 1; i < 5; i++) { if (counts[i] > counts[topIdx]) topIdx = i; }
    return { counts, total: allMoods.length, topIdx, teamCount: entries.length };
  }, [roomState.moodCheckins]);

  // Task progress
  const rawTaskIndex = roomState.taskIndex;
  const totalTasks = roomState.totalTasks || 0;
  const taskIndex = totalTasks > 0 ? Math.min(rawTaskIndex, totalTasks - 1) : rawTaskIndex; // never exceed total
  const hasProgress = totalTasks > 0 && taskIndex >= 0;
  const progressPct = hasProgress ? Math.min(100, ((taskIndex + 1) / totalTasks) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-600 via-purple-700 to-cyan-600 text-white relative overflow-hidden">
      <AuroraBackdrop />

      {/* Confetti */}
      {showConfetti && (
        <Confetti
          width={dimensions.width || window.innerWidth}
          height={dimensions.height || window.innerHeight}
          recycle={false}
          numberOfPieces={400}
          gravity={0.12}
        />
      )}

      {/* Live score pop-ups — top right */}
      <div
        style={{
          position: "fixed",
          top: 80,
          right: 24,
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <AnimatePresence>
          {scorePopups.map((p) => (
            <ScorePopup
              key={p.id}
              id={p.id}
              teamName={p.teamName}
              points={p.points}
              speedBonus={p.speedBonus}
              correct={p.correct}
            />
          ))}
        </AnimatePresence>
      </div>

      <div className="max-w-7xl mx-auto p-8 relative z-10">
        {/* Sound toggle */}
        <div className="absolute top-8 right-8 z-20">
          <button
            onClick={() => setSoundEnabled((s) => !s)}
            className="p-4 bg-black/30 backdrop-blur rounded-full shadow-lg hover:scale-110 transition"
            title={soundEnabled ? "Sound on" : "Sound off"}
            aria-label="Toggle sound"
          >
            {soundEnabled ? (
              <Volume2 className="w-8 h-8 text-white" />
            ) : (
              <VolumeX className="w-8 h-8 text-gray-300" />
            )}
          </button>
        </div>

        {/* Header: Room Code + play.curriculate.net */}
        <div className="text-center mb-6 select-none">
          <motion.div
            aria-hidden="true"
            className="mx-auto mb-3 h-10 w-[520px] max-w-[90vw] rounded-full blur-2xl opacity-40 bg-white"
            animate={{ opacity: [0.18, 0.45, 0.18] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="flex items-center justify-center gap-3 mb-2 opacity-95">
            <Sparkles className="w-7 h-7" />
            <div className="text-2xl font-extrabold tracking-[0.18em]">ROOM CODE</div>
            <Sparkles className="w-7 h-7" />
          </div>

          <div
            className="font-black leading-none mb-2"
            style={{ fontSize: "clamp(3.5rem, 8vw, 6.6rem)" }}
          >
            {codeUpper || "\u2014"}
          </div>

          <div className="text-xl md:text-2xl font-bold opacity-95 tracking-wide">
            play.curriculate.net
          </div>

          {/* Taskset name */}
          {roomState.tasksetName && (
            <div className="mt-2 text-base md:text-lg font-semibold opacity-80 tracking-wide">
              📚 {roomState.tasksetName}
            </div>
          )}

          {/* Mood summary */}
          {moodSummary && (
            <div className="mt-2 flex items-center justify-center gap-3 text-lg font-bold opacity-90">
              <span>Class mood:</span>
              {MOOD_EMOJIS.map((emoji, i) => (
                moodSummary.counts[i] > 0 && (
                  <span key={i} className="inline-flex items-center gap-1" title={MOOD_LABELS[i]}>
                    <span className="text-2xl">{emoji}</span>
                    <span className="text-sm font-black opacity-80">{moodSummary.counts[i]}</span>
                  </span>
                )
              ))}
              <span className="text-base opacity-75">
                — mostly {MOOD_LABELS[moodSummary.topIdx].toLowerCase()} today!
              </span>
            </div>
          )}

          {/* Task progress bar */}
          {hasProgress && (
            <div className="mt-4 max-w-xl mx-auto">
              <div className="flex items-center justify-between text-sm font-bold opacity-90 mb-1">
                <span className="flex items-center gap-1">
                  <Zap className="w-4 h-4" />
                  Task {taskIndex + 1} of {totalTasks}
                </span>
                <span>{Math.round(progressPct)}%</span>
              </div>
              <div className="w-full h-3 bg-black/30 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-green-400 via-emerald-400 to-cyan-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>
          )}

          {/* Tab buttons */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => setActiveTab("leaderboard")}
              className={`px-6 py-3 rounded-2xl font-extrabold text-lg md:text-xl shadow-lg backdrop-blur transition ${
                activeTab === "leaderboard"
                  ? "bg-white/25 border border-white/40"
                  : "bg-black/20 border border-white/20 hover:bg-white/15"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Trophy className="w-6 h-6" /> Leaderboard
              </span>
            </button>

            <button
              onClick={() => setActiveTab("players")}
              className={`px-6 py-3 rounded-2xl font-extrabold text-lg md:text-xl shadow-lg backdrop-blur transition ${
                activeTab === "players"
                  ? "bg-white/25 border border-white/40"
                  : "bg-black/20 border border-white/20 hover:bg-white/15"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Sparkles className="w-6 h-6" /> Players
              </span>
            </button>

            <button
              onClick={() => setActiveTab("teams")}
              className={`px-6 py-3 rounded-2xl font-extrabold text-lg md:text-xl shadow-lg backdrop-blur transition ${
                activeTab === "teams"
                  ? "bg-white/25 border border-white/40"
                  : "bg-black/20 border border-white/20 hover:bg-white/15"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Users className="w-6 h-6" /> Teams
              </span>
            </button>
          </div>
        </div>

        {/* Podium (always visible) */}
        {topThree.length > 0 && (
          <div className="flex items-end justify-center pb-8 gap-10 md:gap-16 mb-10">
            {displayOrder.map((idx, pos) => {
              const row = topThree[idx] || { name: "\u2014", pts: 0, teamId: `x${idx}` };
              return (
                <motion.div
                  key={row.teamId || idx}
                  initial={{ y: 520, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{
                    delay: pos * 0.12,
                    type: "spring",
                    stiffness: 60,
                    damping: 18,
                  }}
                  className="flex flex-col items-center"
                >
                  {/* Rank-based sizing: 1st biggest, 2nd mid, 3rd current */}
                  {(() => {
                    const sizeClasses = [
                      "w-80 md:w-96",   // 1st — biggest
                      "w-64 md:w-72",   // 2nd — mid
                      "w-56 md:w-64",   // 3rd — current / small
                    ];
                    const trophySizes = [
                      "text-8xl md:text-9xl",
                      "text-6xl md:text-7xl",
                      "text-5xl md:text-6xl",
                    ];
                    const rankSizes = [
                      "text-5xl md:text-6xl",
                      "text-3xl md:text-4xl",
                      "text-2xl md:text-3xl",
                    ];
                    const nameSizes = [
                      "text-3xl md:text-4xl",
                      "text-xl md:text-2xl",
                      "text-lg md:text-xl",
                    ];
                    const ptsSizes = [
                      "text-6xl md:text-7xl",
                      "text-4xl md:text-5xl",
                      "text-3xl md:text-4xl",
                    ];
                    const paddings = [
                      "px-8 py-12",
                      "px-6 py-8",
                      "px-5 py-6",
                    ];
                    return (
                      <>
                        <div className={`${trophySizes[idx]} mb-5`}>{trophyEmojis[idx] || "\uD83C\uDFC5"}</div>

                        <div
                          className={`relative overflow-hidden ${sizeClasses[idx]} rounded-t-3xl ${paddings[idx]} text-center text-white font-black shadow-2xl ring-1 ring-white/20 ${podiumColors[idx]}`}
                        >
                          {/* Shine sweep */}
                          <motion.div
                            aria-hidden="true"
                            className="pointer-events-none absolute -top-10 -left-40 h-40 w-40 rotate-12 bg-white/20 blur-xl"
                            animate={{ x: [-120, 520] }}
                            transition={{
                              duration: 3.6,
                              repeat: Infinity,
                              repeatDelay: 1.4,
                              ease: "easeInOut",
                            }}
                          />

                          <div className={`${rankSizes[idx]} mb-3`}>{idx + 1}</div>

                          <div className={`${nameSizes[idx]} truncate px-2 underline decoration-white/40`}>
                            <span
                              style={{ cursor: "pointer" }}
                              title="Delete/kick this team"
                              onClick={() => openDeleteTeamModal(row.teamId)}
                            >
                              {row.name}
                            </span>
                          </div>

                          <div className={`${ptsSizes[idx]} mt-6`}>
                            <AnimatedPts value={row.pts} /> pts
                          </div>
                        </div>

                        <div
                          className={`w-full h-10 md:h-12 ${podiumColors[idx]} rounded-b-3xl shadow-2xl flex items-center justify-center`}
                        >
                          {idx === 1 && taskEndCelebration && (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="text-white font-black text-base md:text-lg tracking-wider drop-shadow-lg"
                              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}
                            >
                              🏆 WINNER 🏆
                            </motion.span>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Top 3 Players */}
        {topPlayers.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center justify-center gap-2 mb-5 opacity-95">
              <Sparkles className="w-5 h-5" />
              <div className="text-xl md:text-2xl font-extrabold tracking-wide">Top Players</div>
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="flex items-end justify-center gap-6 md:gap-10">
              {[1, 0, 2].map((idx, pos) => {
                const player = topPlayers[idx];
                if (!player) return null;
                const heights = ["h-32 md:h-36", "h-40 md:h-44", "h-24 md:h-28"];
                const gradients = [
                  "from-amber-400/90 to-yellow-600/90",
                  "from-cyan-400/90 to-blue-600/90",
                  "from-rose-400/90 to-pink-600/90",
                ];
                const medals = ["🥈", "🥇", "🥉"];
                return (
                  <motion.div
                    key={player.name}
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: pos * 0.1, type: "spring", stiffness: 70, damping: 16 }}
                    className="flex flex-col items-center"
                  >
                    <div className="text-4xl md:text-5xl mb-2">{medals[idx]}</div>
                    <div
                      className={`${heights[idx]} w-40 md:w-48 bg-gradient-to-b ${gradients[idx]} rounded-t-2xl flex flex-col items-center justify-center px-3 text-center shadow-xl ring-1 ring-white/20`}
                    >
                      <div className="text-lg md:text-xl font-black truncate w-full">{player.name}</div>
                      <div className="text-2xl md:text-3xl font-black mt-1">
                        <AnimatedPts value={player.pts} />
                      </div>
                      <div className="text-xs md:text-sm font-bold opacity-80 mt-1">{player.teamName || "—"}</div>
                    </div>
                    <div className={`w-full h-2 bg-gradient-to-b ${gradients[idx]} rounded-b-2xl shadow-lg`} />
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="bg-black/20 border border-white/20 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur">
          {activeTab === "leaderboard" ? (
            <div className="flex gap-6">
              {/* Left: Team Leaderboard */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-5 opacity-95">
                  <Trophy className="w-6 h-6" />
                  <div className="text-2xl md:text-3xl font-extrabold">Team Leaderboard</div>
                </div>

                {leaderboard.length === 0 ? (
                  <div className="text-center text-2xl opacity-90 py-10">
                    No scores yet. Waiting for teams to join...
                  </div>
                ) : (
                  <ol className="space-y-4 text-xl md:text-2xl">
                    <AnimatePresence>
                      {leaderboard.map((row, i) => (
                        <motion.li
                          key={row.teamId}
                          layout
                          initial={{ opacity: 0, x: 60 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -60 }}
                          transition={{ duration: 0.25 }}
                          className="group relative overflow-hidden bg-white/10 border border-white/20 rounded-2xl px-5 py-4 flex items-center shadow-lg hover:bg-white/15 hover:shadow-2xl hover:-translate-y-0.5 transition"
                          style={{ cursor: "default" }}
                        >
                          {/* Hover glow + shimmer */}
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-300"
                            style={{
                              backgroundImage:
                                "radial-gradient(600px circle at 20% 10%, rgba(255,255,255,0.14), transparent 60%), radial-gradient(500px circle at 85% 40%, rgba(34,211,238,0.16), transparent 55%)",
                            }}
                          />
                          <motion.div
                            aria-hidden="true"
                            className="pointer-events-none absolute -top-10 -left-52 h-24 w-52 rotate-12 bg-white/10 blur-lg"
                            animate={{ x: [-120, 820] }}
                            transition={{
                              duration: 5.5,
                              repeat: Infinity,
                              repeatDelay: 1.2,
                              ease: "easeInOut",
                            }}
                          />

                          <span className="font-black text-2xl md:text-3xl w-14 text-white/95 relative">
                            {i + 1}.
                          </span>

                          {row.thumb ? (
                            <img
                              src={row.thumb}
                              alt={row.name}
                              className="w-11 h-11 md:w-12 md:h-12 rounded-full object-cover border-2 border-white/60 shadow-lg mr-4 relative"
                            />
                          ) : (
                            <div className="w-11 h-11 md:w-12 md:h-12 rounded-full bg-white/10 border border-white/25 mr-4 relative" />
                          )}

                          <span
                            className="font-extrabold flex-1 truncate relative"
                            title="Delete/kick this team"
                            style={{ cursor: "pointer" }}
                            onClick={() => openDeleteTeamModal(row.teamId)}
                          >
                            {row.name}
                          </span>

                          <span className="font-black text-2xl md:text-3xl ml-4 relative">
                            <AnimatedPts value={row.pts} /> pts
                          </span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ol>
                )}
              </div>

              {/* Right: Players sidebar */}
              {(roomState.playerScores || []).length > 0 && (
                <div className="w-72 md:w-80 flex-shrink-0">
                  <div className="flex items-center gap-2 mb-5 opacity-95">
                    <Sparkles className="w-5 h-5" />
                    <div className="text-xl md:text-2xl font-extrabold">Players</div>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {(roomState.playerScores || []).map((p, i) => (
                        <motion.div
                          key={p.name}
                          layout
                          initial={{ opacity: 0, x: 30 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 30 }}
                          transition={{ duration: 0.2 }}
                          className="bg-white/10 border border-white/15 rounded-xl px-3 py-2 flex items-center gap-2 shadow"
                        >
                          <span className="font-black text-base w-8 text-white/90">
                            {i < 3 ? trophyEmojis[i] : `${i + 1}.`}
                          </span>
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 border border-white/30 flex items-center justify-center text-sm font-black shadow">
                            {(p.name || "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm truncate">{p.name}</div>
                            <div className="text-xs font-semibold opacity-60">{p.teamName || "—"}</div>
                          </div>
                          <div className="font-black text-base ml-1">
                            <AnimatedPts value={p.pts} />
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "players" ? (
            <>
              <div className="flex items-center gap-2 mb-5 opacity-95">
                <Sparkles className="w-6 h-6" />
                <div className="text-2xl md:text-3xl font-extrabold">All Players</div>
              </div>

              {(roomState.playerScores || []).length === 0 ? (
                <div className="text-center text-2xl opacity-90 py-10">
                  No individual scores yet. Players earn points as they complete tasks.
                </div>
              ) : (
                <ol className="space-y-3 text-xl md:text-2xl">
                  <AnimatePresence>
                    {(roomState.playerScores || []).map((p, i) => (
                      <motion.li
                        key={p.name}
                        layout
                        initial={{ opacity: 0, x: 60 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -60 }}
                        transition={{ duration: 0.25 }}
                        className="group relative overflow-hidden bg-white/10 border border-white/20 rounded-2xl px-5 py-3 flex items-center shadow-lg hover:bg-white/15 transition"
                        style={{ cursor: "default" }}
                      >
                        <span className="font-black text-2xl md:text-3xl w-14 text-white/95">
                          {i < 3 ? trophyEmojis[i] : `${i + 1}.`}
                        </span>

                        <div className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 border-2 border-white/40 mr-4 flex items-center justify-center text-lg font-black shadow-lg">
                          {(p.name || "?").charAt(0).toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-extrabold truncate">{p.name}</div>
                          <div className="text-sm font-bold opacity-70">{p.teamName || "—"}</div>
                        </div>

                        <div className="text-right ml-4">
                          <div className="font-black text-2xl md:text-3xl">
                            <AnimatedPts value={p.pts} />
                          </div>
                          <div className="text-xs font-bold opacity-60">{p.tasks} task{p.tasks !== 1 ? "s" : ""}</div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ol>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-5 opacity-95">
                <Users className="w-6 h-6" />
                <div className="text-2xl md:text-3xl font-extrabold">Teams</div>
              </div>

              {Object.keys(roomState.teams || {}).length === 0 ? (
                <div className="text-center text-2xl opacity-90 py-10">
                  No teams yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.values(roomState.teams || {}).map((t) => {
                    const id = t.id || t.teamId || t._id;
                    const name = t.teamName || t.name || "Team";
                    const pts = (roomState.scores || {})[id] || 0;
                    const thumb = latestPhotos[id]?.url || null;

                    return (
                      <div
                        key={id}
                        className="bg-white/10 border border-white/20 rounded-2xl p-4 flex items-center gap-4 shadow-lg hover:bg-white/15 transition"
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={name}
                            className="w-12 h-12 rounded-full object-cover border-2 border-white/60 shadow"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-white/10 border border-white/25" />
                        )}

                        <div className="flex-1 min-w-0">
                          <div
                            className="font-extrabold text-xl truncate underline decoration-white/30"
                            title="Delete/kick this team"
                            style={{ cursor: "pointer" }}
                            onClick={() => openDeleteTeamModal(id)}
                          >
                            {name}
                          </div>
                        </div>

                        <div className="font-black text-2xl">
                          <AnimatedPts value={pts} /> pts
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Delete team modal */}
        {deleteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
            <div className="w-full max-w-lg bg-zinc-900 text-white rounded-3xl border border-white/20 shadow-2xl p-6">
              <div className="text-2xl font-extrabold mb-2">Kick team?</div>
              <div className="opacity-90 mb-6">
                This will remove the team from the room. (They can re-join if they scan again.)
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={closeDeleteTeamModal}
                  className="px-5 py-3 rounded-2xl bg-white/10 border border-white/20 hover:bg-white/15 transition font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={kickTeam}
                  className="px-5 py-3 rounded-2xl bg-red-500/90 hover:bg-red-500 transition font-black"
                >
                  Kick Team
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
