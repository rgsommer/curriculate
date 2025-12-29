// teacher-app/src/pages/HostView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { Trophy, Camera, Users, Sparkles, Volume2, VolumeX } from "lucide-react";

const trophyEmojis = ["🥇", "🥈", "🥉"];
const podiumHeights = ["h-40", "h-56", "h-32"];
const podiumColors = [
  "bg-gradient-to-b from-cyan-400 to-blue-600 shadow-cyan-500/50",
  "bg-gradient-to-b from-yellow-300 to-amber-500 shadow-yellow-400/50",
  "bg-gradient-to-b from-pink-400 to-rose-600 shadow-pink-500/50",
];

const PHOTO_TASK_TYPES = new Set([
  "photo-task",
  "phototask",
  "photo",
  "photojournal",
  "photo-journal",
  "photoJournal",
  "PhotoTask",
  "PhotoJournal",
]);

/* ------------------------------------------------------------
   Option A: Vibrant HostView visuals (no new dependencies)
   - Soft animated glow blobs
   - Subtle grain / rays overlay
------------------------------------------------------------ */
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
      {/* Soft glow blobs */}
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

      {/* Grain + rays overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay"
        style={AURORA_OVERLAY_STYLE}
      />
    </>
  );
}

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

export default function HostView({ roomCode: roomCodeProp }) {

  const location = useLocation();
  const qs = new URLSearchParams(location.search || "");
  const roomFromQuery = (qs.get("room") || "").trim().toUpperCase();
  const sharedToken = (qs.get("sharedToken") || qs.get("token") || "").trim();
  const reportOwnerName = (qs.get("reportOwnerName") || qs.get("from") || "").trim();
  const reportOwnerEmail = (qs.get("reportOwnerEmail") || "").trim();

  const roomCode = roomFromQuery || (roomCodeProp || "").trim().toUpperCase();
  const [roomState, setRoomState] = useState({
    teams: {},
    scores: {},
    submissions: [],
    taskIndex: -1,
    locationCode: "Classroom",
  });

  const [activeTab, setActiveTab] = useState("leaderboard");
  const [showConfetti, setShowConfetti] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Delete team modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTeamId, setDeleteTeamId] = useState(null);

  // Sound refs (kept from your working HostView)
  const joinSoundRef = useRef(null);
  const correctSoundRef = useRef(null);
  const wrongSoundRef = useRef(null);
  const cheerSoundRef = useRef(null);

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

  useEffect(() => {
    // Prepare sounds (safe: if missing, play() just fails silently)
    const load = (ref, src) => {
      try {
        ref.current = new Audio(src);
        ref.current.preload = "auto";
        ref.current.volume = 0.7;
      } catch {
        ref.current = null;
      }
    };

    load(joinSoundRef, "/sounds/team-join.mp3");
    load(correctSoundRef, "/sounds/correct-ding.mp3");
    load(wrongSoundRef, "/sounds/wrong-buzzer.mp3");
    load(cheerSoundRef, "/sounds/applause-cheer.mp3");

    const handleResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const playSound = (ref) => {
    if (!soundEnabled || !ref?.current) return;
    try {
      ref.current.currentTime = 0;
      ref.current.play().catch(() => {});
    } catch {
      // ignore
    }
  };

  // Socket: keep the same working events (roomState / room:state / team:joined)
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
        submissions: Array.isArray(safe.submissions)
          ? safe.submissions
          : prev.submissions || [],
        taskIndex: typeof safe.taskIndex === "number" ? safe.taskIndex : prev.taskIndex,
        locationCode: safe.locationCode || prev.locationCode || "Classroom",
      }));
    };

    const handleTeamJoined = () => {
      playSound(joinSoundRef);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2000);
    };

    const handleScoreUpdate = () => {
      playSound(correctSoundRef);
    };

    const handleWrong = () => {
      playSound(wrongSoundRef);
    };

    const handleEnded = () => {
      playSound(cheerSoundRef);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 7000);
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("teamJoined", handleTeamJoined);
    socket.on("team:joined", handleTeamJoined);
    socket.on("score:updated", handleScoreUpdate);
    socket.on("score:wrong", handleWrong);
    socket.on("session-ended", handleEnded);

    socket.emit("room:request-state", { roomCode: code });

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("team:joined", handleTeamJoined);
      socket.off("score:updated", handleScoreUpdate);
      socket.off("score:wrong", handleWrong);
      socket.off("session-ended", handleEnded);
    };
  }, [roomCode, soundEnabled]);

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

    const rows = Object.values(teamsObj)
      .map((t) => ({
        teamId: t.id || t.teamId || t._id,
        name: t.teamName || t.name || "Team",
        pts: scoresObj[t.id || t.teamId || t._id] || 0,
        thumb: latestPhotos[t.id || t.teamId || t._id]?.url || null,
      }))
      .filter((r) => !!r.teamId)
      .sort((a, b) => b.pts - a.pts);

    return rows;
  }, [roomState.teams, roomState.scores, latestPhotos]);

  const topThree = useMemo(() => leaderboard.slice(0, 3), [leaderboard]);

  // Display order: [2nd, 1st, 3rd] for podium vibe
  const displayOrder = [1, 0, 2];

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-600 via-purple-700 to-cyan-600 text-white relative overflow-hidden">
      {/* Vibrant backdrop (Option A) */}
      <AuroraBackdrop />

      {/* Confetti */}
      {showConfetti && (
        <Confetti
          width={dimensions.width || window.innerWidth}
          height={dimensions.height || window.innerHeight}
          recycle={false}
          numberOfPieces={320}
          gravity={0.14}
        />
      )}

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
        <div className="text-center mb-8 select-none">
          {/* Title glow “halo” */}
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
            {codeUpper || "—"}
          </div>

          <div className="text-xl md:text-2xl font-bold opacity-95 tracking-wide">
            play.curriculate.net
          </div>

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
              const row = topThree[idx] || { name: "—", pts: 0, teamId: `x${idx}` };
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
                  <div className="text-7xl md:text-8xl mb-5">{trophyEmojis[idx] || "🏅"}</div>

                  <div
                    className={`relative overflow-hidden w-72 md:w-80 rounded-t-3xl px-8 py-10 text-center text-white font-black shadow-2xl ring-1 ring-white/20 ${podiumColors[idx]}`}
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

                    <div className="text-4xl md:text-5xl mb-3">{idx + 1}</div>

                    <div className="text-2xl md:text-3xl truncate px-2 underline decoration-white/40">
                      {/* NAME ONLY clickable for delete */}
                      <span
                        style={{ cursor: "pointer" }}
                        title="Delete/kick this team"
                        onClick={() => openDeleteTeamModal(row.teamId)}
                      >
                        {row.name}
                      </span>
                    </div>

                    <div className="text-5xl md:text-6xl mt-6">{row.pts} pts</div>
                  </div>

                  <div
                    className={`w-full h-10 md:h-12 ${podiumColors[idx]} rounded-b-3xl shadow-2xl`}
                  />
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Main content */}
        <div className="bg-black/20 border border-white/20 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur">
          {activeTab === "leaderboard" ? (
            <>
              <div className="flex items-center gap-2 mb-5 opacity-95">
                <Trophy className="w-6 h-6" />
                <div className="text-2xl md:text-3xl font-extrabold">Full Leaderboard</div>
              </div>

              {leaderboard.length === 0 ? (
                <div className="text-center text-2xl opacity-90 py-10">
                  No scores yet.
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
                        style={{ cursor: "default" }} // safe for scroll
                      >
                        {/* Hover glow + subtle shimmer */}
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

                        {/* Photo thumb if available */}
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
                          {row.pts} pts
                        </span>
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
                          <div className="opacity-90">ID: {id}</div>
                        </div>

                        <div className="font-black text-2xl">{pts} pts</div>
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
