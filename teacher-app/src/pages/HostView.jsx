// teacher-app/src/pages/HostView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";

const trophyEmojis = ["🥇", "🥈", "🥉"];
const podiumHeights = ["h-32", "h-48", "h-24"]; // 2nd, 1st, 3rd
const podiumColors = ["bg-gray-400", "bg-yellow-500", "bg-orange-600"];

// Photo task types (keep broad so it works with your naming)
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
  const joinSoundRef = useRef(null);
  const fanfareRef = useRef(null);
  const cheerRef = useRef(null);

  // Sound preloading
  useEffect(() => {
    joinSoundRef.current = new Audio("/sounds/join.mp3");
    fanfareRef.current = new Audio("/sounds/fanfare.mp3");
    cheerRef.current = new Audio("/sounds/cheer.mp3");

    [joinSoundRef, fanfareRef, cheerRef].forEach((ref) => {
      if (ref.current) ref.current.volume = 0.7;
    });
  }, []);

  // Autoplay unlock
  useEffect(() => {
    const unlock = () => {
      [joinSoundRef, fanfareRef, cheerRef].forEach((ref) => {
        if (ref.current) {
          ref.current.muted = true;
          ref.current
            .play()
            .then(() => {
              ref.current.pause();
              ref.current.currentTime = 0;
              ref.current.muted = false;
            })
            .catch(() => {});
        }
      });
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);

  // Socket logic
  useEffect(() => {
    if (!roomCode) return;
    const code = String(roomCode).toUpperCase().trim();
    socket.emit("joinRoom", { roomCode: code, role: "host", name: "Host" });

    const handleRoom = (state) => {
      const safe = state || {};
      setRoomState((prev) => {
        const newLeaderboard = Object.entries(safe.scores || {})
          .map(([id, pts]) => ({
            teamId: id,
            pts: pts || 0,
            name: safe.teams?.[id]?.teamName || id,
          }))
          .sort((a, b) => b.pts - a.pts);

        if (prevLeaderboard.length > 0) {
          const oldLeader = prevLeaderboard[0]?.teamId;
          const newLeader = newLeaderboard[0]?.teamId;
          if (newLeader && newLeader !== oldLeader) {
            cheerRef.current?.play().catch(() => {});
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 6000);
          } else if (newLeaderboard.some((row, i) => row.pts > (prevLeaderboard[i]?.pts || 0))) {
            fanfareRef.current?.play().catch(() => {});
          }
        }
        setPrevLeaderboard(newLeaderboard);

        return {
          ...prev,
          teams: safe.teams || {},
          scores: safe.scores || {},
          submissions: Array.isArray(safe.submissions) ? safe.submissions : prev.submissions || [],
        };
      });
    };

    const handleTeamJoined = () => {
      joinSoundRef.current?.play().catch(() => {});
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, prevLeaderboard]);

  // Memoized data
  const teams = useMemo(() => {
    return Object.entries(roomState.teams || {}).map(([id, t]) => ({
      teamId: id,
      teamName: t.teamName || t.name || id,
      members: Array.isArray(t.members) ? t.members : [],
      station: t.currentStationId || t.station || "—",
    }));
  }, [roomState.teams]);

  const leaderboard = useMemo(() => {
    return Object.entries(roomState.scores || {})
      .map(([id, pts]) => ({
        teamId: id,
        pts: pts || 0,
        name: roomState.teams?.[id]?.teamName || id,
      }))
      .sort((a, b) => b.pts - a.pts);
  }, [roomState.scores, roomState.teams]);

  const latestPhotoByTeam = useMemo(() => {
    return buildLatestPhotoByTeam(roomState.submissions || []);
  }, [roomState.submissions]);

  const topThree = leaderboard.slice(0, 3);
  const displayOrder = [1, 0, 2]; // 2nd left, 1st center, 3rd right

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-purple-600 to-blue-800 flex flex-col overflow-hidden relative">
      {showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={300}
          gravity={0.15}
        />
      )}

      {/* Podium Section */}
      {topThree.length > 0 && (
        <div className="flex-1 flex items-end justify-center pb-8 gap-12 md:gap-20">
          {displayOrder.map((idx, pos) => {
            const team = topThree[idx] || { name: "—", pts: 0 };
            return (
              <motion.div
                key={team.teamId || idx}
                initial={{ y: 600, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: pos * 1.5, type: "spring", stiffness: 60, damping: 18 }}
                className="flex flex-col items-center"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: pos * 1.5 + 0.5, type: "spring", stiffness: 100 }}
                  className="text-8xl md:text-9xl mb-8"
                >
                  {trophyEmojis[idx] || "🏅"}
                </motion.div>

                <motion.div
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: pos * 1.5 + 0.8, duration: 0.4 }}
                  className={`origin-bottom w-64 md:w-80 rounded-t-3xl px-8 py-12 text-center text-white font-bold shadow-2xl ${podiumColors[idx]}`}
                >
                  <div className="text-5xl md:text-6xl mb-4">
                    {idx + 1}
                    {idx === 0 ? "st" : idx === 1 ? "nd" : "rd"}
                  </div>
                  <div className="text-3xl md:text-4xl truncate px-4">{team.name}</div>
                  <div className="text-6xl md:text-7xl mt-8">{team.pts} pts</div>
                </motion.div>

                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: "100%" }}
                  transition={{ delay: pos * 1.5, duration: 1.2, ease: "easeOut" }}
                  className={`w-full ${podiumHeights[idx]} ${podiumColors[idx]} rounded-b-3xl shadow-2xl origin-bottom`}
                />
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Integrated Teams + Full Leaderboard Section */}
      <div className="w-full bg-white/95 backdrop-blur shadow-2xl">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 p-12">
          {/* Teams List */}
          <div>
            <h2 className="text-5xl font-bold text-center mb-10 text-indigo-700">Teams</h2>
            {teams.length === 0 ? (
              <div className="text-center text-3xl text-gray-600">No teams joined yet.</div>
            ) : (
              <div className="space-y-6">
                {teams
                  .slice()
                  .sort((a, b) => a.teamName.localeCompare(b.teamName))
                  .map((t) => (
                    <motion.div
                      key={t.teamId}
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4 }}
                      className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-8 shadow-lg"
                    >
                      <div className="text-4xl font-bold text-indigo-800">{t.teamName}</div>
                      {t.members.length > 0 && (
                        <div className="text-2xl text-gray-700 mt-2">{t.members.join(", ")}</div>
                      )}
                      <div className="text-2xl text-gray-600 mt-4">
                        Station:{" "}
                        <span className="font-mono bg-gray-200 px-4 py-2 rounded-lg">{t.station}</span>
                      </div>
                    </motion.div>
                  ))}
              </div>
            )}
          </div>

          {/* Full Leaderboard */}
          <div>
            <h2 className="text-5xl font-bold text-center mb-10 text-indigo-700">Full Leaderboard</h2>
            {leaderboard.length === 0 ? (
              <div className="text-center text-3xl text-gray-600">No scores yet.</div>
            ) : (
              <ol className="space-y-8 text-3xl md:text-4xl">
                <AnimatePresence>
                  {leaderboard.map((row, i) => {
                    const thumb = latestPhotoByTeam?.[row.teamId]?.url;

                    return (
                      <motion.li
                        key={row.teamId}
                        layout
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -100 }}
                        transition={{ delay: i * 0.05, duration: 0.5 }}
                        className="bg-gradient-to-r from-gray-100 to-gray-50 rounded-2xl px-10 py-8 flex items-center shadow-lg"
                      >
                        {/* Rank */}
                        <span className="font-black text-5xl text-indigo-600">{i + 1}.</span>

                        {/* Thumb */}
                        {thumb ? (
                          <img
                            src={thumb}
                            alt="photo submission"
                            className="ml-8"
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              objectFit: "cover",
                              border: "1px solid rgba(0,0,0,0.12)",
                              flex: "0 0 auto",
                            }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="ml-8" style={{ width: 44, height: 44, flex: "0 0 auto" }} />
                        )}

                        {/* Name */}
                        <span className="font-bold flex-1 text-left ml-10">{row.name}</span>

                        {/* Points */}
                        <span className="font-black text-6xl text-indigo-700">{row.pts} pts</span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
