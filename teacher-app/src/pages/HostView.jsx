// teacher-app/src/pages/HostView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import {
  Trophy,
  Camera,
  Users,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";

const trophyEmojis = ["🥇", "🥈", "🥉"];

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

function formatTeamLabel(team) {
  const base = team?.teamName || team?.name || "Team";
  const emoji = team?.teamEmoji || "";
  return emoji ? `${emoji} ${base}` : base;
}

export default function HostView({ roomCode }) {
  const [roomState, setRoomState] = useState({
    teams: {},
    scores: {},
    submissions: [],
    taskIndex: -1,
    locationCode: "Classroom",
  });

  const [showConfetti, setShowConfetti] = useState(false);
  const [prevLeaderboard, setPrevLeaderboard] = useState([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeTab, setActiveTab] = useState("leaderboard"); // "leaderboard" | "teams"
  const [soundEnabled, setSoundEnabled] = useState(true);

  // delete-team modal (click NAME only)
  const [deleteTeamModal, setDeleteTeamModal] = useState(null);
  // { teamId, label }

  // Sound refs
  const joinSoundRef = useRef(null);
  const fanfareRef = useRef(null);
  const cheerRef = useRef(null);

  // Preload sounds + resize listener (confetti sizing)
  useEffect(() => {
    // You already used these names earlier; keep them stable.
    joinSoundRef.current = new Audio("/sounds/join.mp3");
    fanfareRef.current = new Audio("/sounds/fanfare.mp3");
    cheerRef.current = new Audio("/sounds/cheer.mp3");

    [joinSoundRef, fanfareRef, cheerRef].forEach((ref) => {
      if (ref.current) {
        ref.current.preload = "auto";
        ref.current.volume = 0.7;
      }
    });

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

    // Join as host (your existing HostView already did this)
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
      setTimeout(() => setShowConfetti(false), 2500);
    };

    socket.on("roomState", handleRoom);
    socket.on("room:state", handleRoom);
    socket.on("teamJoined", handleTeamJoined);
    socket.on("team:joined", handleTeamJoined);

    return () => {
      socket.off("roomState", handleRoom);
      socket.off("room:state", handleRoom);
      socket.off("teamJoined", handleTeamJoined);
      socket.off("team:joined", handleTeamJoined);
    };
  }, [roomCode, soundEnabled]);

  // Derived data
  const latestPhotoByTeam = useMemo(
    () => buildLatestPhotoByTeam(roomState.submissions || []),
    [roomState.submissions]
  );

  const teams = useMemo(() => {
    return Object.entries(roomState.teams || {}).map(([id, t]) => ({
      teamId: id,
      label: formatTeamLabel(t) || id,
      rawTeamName: t.teamName || t.name || id,
      members: Array.isArray(t.members) ? t.members : [],
      station: t.currentStationId || t.station || "—",
      emoji: t.teamEmoji || "",
    }));
  }, [roomState.teams]);

  const leaderboard = useMemo(() => {
    return Object.entries(roomState.scores || {})
      .map(([id, pts]) => {
        const t = roomState.teams?.[id] || {};
        return {
          teamId: id,
          name: formatTeamLabel(t) || id,
          pts: typeof pts === "number" ? pts : 0,
          thumb: latestPhotoByTeam?.[id]?.url || null,
        };
      })
      .sort((a, b) => b.pts - a.pts);
  }, [roomState.scores, roomState.teams, latestPhotoByTeam]);

  // Confetti + sounds when leader changes (preserves previous behavior)
  useEffect(() => {
    if (!leaderboard.length) return;

    if (prevLeaderboard.length > 0) {
      const oldLeader = prevLeaderboard[0]?.teamId;
      const newLeader = leaderboard[0]?.teamId;

      if (newLeader && oldLeader && newLeader !== oldLeader) {
        playSound(cheerRef);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 6000);
      } else {
        // If any score increased, do a softer fanfare
        let increased = false;
        for (let i = 0; i < leaderboard.length; i++) {
          if ((leaderboard[i]?.pts || 0) > (prevLeaderboard[i]?.pts || 0)) {
            increased = true;
            break;
          }
        }
        if (increased) playSound(fanfareRef);
      }
    }

    setPrevLeaderboard(leaderboard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboard]);

  const topThree = leaderboard.slice(0, 3);
  const displayOrder = [1, 0, 2]; // 2nd left, 1st center, 3rd right

  // Delete/kick handlers
  const openDeleteTeamModal = (teamId) => {
    const t = roomState?.teams?.[teamId] || {};
    setDeleteTeamModal({ teamId, label: formatTeamLabel(t) });
  };

  const confirmDeleteTeam = () => {
    const teamId = deleteTeamModal?.teamId;
    const code = String(roomCode || "").toUpperCase().trim();
    if (!teamId || !code) return;

    socket.emit("teacher:deleteTeam", { roomCode: code, teamId }, (ack) => {
      setDeleteTeamModal(null);
      if (!ack?.ok) console.error("teacher:deleteTeam failed:", ack?.error);
    });
  };

  const codeUpper = (roomCode || "").toUpperCase().trim();

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-600 via-purple-700 to-cyan-600 text-white relative overflow-hidden">
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

      {/* Subtle background glow */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[520px] h-[520px] bg-white/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[520px] h-[520px] bg-white/20 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto p-8 relative z-10">
        {/* Sound toggle */}
        <div className="absolute top-8 right-8 z-20">
          <button
            onClick={() => setSoundEnabled((v) => !v)}
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
          <div className="flex items-center justify-center gap-3 mb-2 opacity-95">
            <Sparkles className="w-7 h-7" />
            <div className="text-2xl font-extrabold tracking-[0.18em]">
              ROOM CODE
            </div>
            <Sparkles className="w-7 h-7" />
          </div>

          <div className="font-black leading-none mb-2" style={{ fontSize: "clamp(3.5rem, 8vw, 6.6rem)" }}>
            {codeUpper || "—"}
          </div>

          <div className="text-xl md:text-2xl font-bold opacity-95 tracking-wide">
            play.curriculate.net
          </div>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-4 mb-8">
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

        {/* Podium (always visible, keeps your “wow” moment) */}
        {topThree.length > 0 && (
          <div className="flex items-end justify-center pb-8 gap-10 md:gap-16 mb-10">
            {displayOrder.map((idx, pos) => {
              const row = topThree[idx] || { name: "—", pts: 0, teamId: `x${idx}` };
              return (
                <motion.div
                  key={row.teamId || idx}
                  initial={{ y: 520, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: pos * 0.12, type: "spring", stiffness: 60, damping: 18 }}
                  className="flex flex-col items-center"
                >
                  <div className="text-7xl md:text-8xl mb-5">{trophyEmojis[idx] || "🏅"}</div>

                  <div
                    className={`w-72 md:w-80 rounded-t-3xl px-8 py-10 text-center text-white font-black shadow-2xl ${podiumColors[idx]}`}
                  >
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
                        className="bg-white/10 border border-white/20 rounded-2xl px-5 py-4 flex items-center shadow-lg"
                        style={{ cursor: "default" }} // safe for scroll
                      >
                        <span className="font-black text-2xl md:text-3xl w-14 text-white/95">
                          {i + 1}.
                        </span>

                        {/* Photo thumb (if any) */}
                        {row.thumb ? (
                          <img
                            src={row.thumb}
                            alt="photo submission"
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              objectFit: "cover",
                              border: "1px solid rgba(255,255,255,0.25)",
                              marginRight: 14,
                              flex: "0 0 auto",
                            }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div style={{ width: 44, height: 44, marginRight: 14 }} />
                        )}

                        {/* NAME ONLY clickable for delete */}
                        <span
                          className="font-extrabold flex-1 text-left underline decoration-white/30"
                          style={{ cursor: "pointer" }}
                          title="Delete/kick this team"
                          onClick={() => openDeleteTeamModal(row.teamId)}
                        >
                          {row.name}
                        </span>

                        <span className="font-black text-3xl md:text-4xl text-white">
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

              {teams.length === 0 ? (
                <div className="text-center text-2xl opacity-90 py-10">
                  No teams joined yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {teams
                    .slice()
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((t) => (
                      <motion.div
                        key={t.teamId}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22 }}
                        className="bg-white/10 border border-white/20 rounded-2xl p-5 shadow-lg"
                        style={{ cursor: "default" }} // safe for scroll
                      >
                        {/* NAME ONLY clickable for delete */}
                        <div
                          className="text-2xl md:text-3xl font-black underline decoration-white/30"
                          style={{ cursor: "pointer" }}
                          title="Delete/kick this team"
                          onClick={() => openDeleteTeamModal(t.teamId)}
                        >
                          {t.label}
                        </div>

                        {t.members?.length > 0 && (
                          <div className="text-white/90 mt-1">
                            {t.members.join(", ")}
                          </div>
                        )}

                        <div className="mt-3 flex items-center gap-3 text-white/90">
                          <Camera className="w-5 h-5 opacity-90" />
                          <span className="font-semibold">
                            Latest photo:
                          </span>
                          <span className="opacity-90">
                            {latestPhotoByTeam?.[t.teamId]?.url ? "Yes" : "—"}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirm delete/kick modal */}
      {deleteTeamModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setDeleteTeamModal(null)}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "white",
              borderRadius: 16,
              padding: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
              Delete team?
            </div>

            <div style={{ color: "#374151", marginBottom: 14, lineHeight: 1.35 }}>
              Remove <strong>{deleteTeamModal.label}</strong> from this room and
              kick them off immediately?
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setDeleteTeamModal(null)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                onClick={confirmDeleteTeam}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid #991b1b",
                  background: "#dc2626",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Delete & kick
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
