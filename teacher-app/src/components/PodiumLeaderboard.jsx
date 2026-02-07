// src/components/PodiumLeaderboard.jsx
import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Confetti from "react-confetti";

const trophyEmojis = ["🥇", "🥈", "🥉"];
const podiumHeights = ["h-48", "h-64", "h-40"]; // 2nd, 1st, 3rd
const podiumColors = ["bg-gray-400", "bg-yellow-500", "bg-orange-600"];

export default function PodiumLeaderboard({
  topThree = [],
  showConfetti = true,
  currentTeamName,
}) {
  const fanfareRef = useRef(null);
  const bigCheerRef = useRef(null);

  useEffect(() => {
    // Preload sounds (place files in public/sounds/)
    fanfareRef.current = new Audio("/sounds/victory-fanfare.mp3"); // Short fanfare for each reveal
    bigCheerRef.current = new Audio("/sounds/crowd-cheer-applause.mp3"); // Big cheer for 1st

    return () => {
      fanfareRef.current = null;
      bigCheerRef.current = null;
    };
  }, []);

  const playFanfare = () => {
    if (fanfareRef.current) {
      fanfareRef.current.currentTime = 0;
      fanfareRef.current.play().catch(() => {}); // Ignore autoplay blocks
    }
  };

  const playBigCheer = () => {
    if (bigCheerRef.current) {
      bigCheerRef.current.currentTime = 0;
      bigCheerRef.current.play().catch(() => {});
    }
  };
  if (topThree.length === 0) {
    return (
      <div className="text-center text-white text-2xl">
        No winners yet—keep playing! 🚀
      </div>
    );
  }

  // Pad to 3 if fewer teams
  const podium = [...topThree];
  while (podium.length < 3) {
    podium.push({ teamName: "—", score: 0, placeholder: true });
  }

  // Reorder: index 1 = 2nd place, index 0 = 1st, index 2 = 3rd
  const displayOrder = [1, 0, 2];

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-indigo-900 via-purple-900 to-pink-900 flex flex-col items-center justify-end pb-20 overflow-hidden">
      {showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} recycle={false} numberOfPieces={400} gravity={0.15} />}

      <h1 className="absolute top-10 text-5xl font-bold text-white drop-shadow-2xl">
        🎉 Final Podium 🎉
      </h1>

      <div className="flex items-end justify-center gap-8 md:gap-16">
        {displayOrder.map((origIndex, displayIdx) => {
          const team = podium[origIndex];
          const isCurrent = team.teamName === currentTeamName;

          return (
            <motion.div
              key={origIndex}
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: displayIdx * 0.3, type: "spring", stiffness: 80 }}
              className="flex flex-col items-center"
            >
              {/* Trophy */}
              <div className="text-6xl md:text-8xl mb-4">
                {trophyEmojis[origIndex] || "🏅"}
              </div>

              {/* Team Card */}
              <div
                className={`w-48 md:w-64 rounded-t-3xl px-6 py-8 text-center text-white font-bold shadow-2xl ${
                  podiumColors[origIndex]
                } ${isCurrent ? "ring-8 ring-yellow-300" : ""} ${team.placeholder ? "opacity-50" : ""}`}
              >
                <div className="text-2xl md:text-4xl mb-2">
                  {origIndex + 1}{origIndex === 0 ? "st" : origIndex === 1 ? "nd" : "rd"}
                </div>
                <div className="text-xl md:text-3xl truncate px-2">
                  {team.teamName}
                </div>
                <div className="text-3xl md:text-5xl mt-4">
                  {team.score} pts
                </div>
              </div>

              {/* Podium Base */}
              <div className="flex items-end justify-center gap-8 md:gap-16">
        {displayOrder.map((origIndex, displayIdx) => {
          const team = podium[origIndex];
          const isCurrent = team.teamName === currentTeamName;

          return (
            <motion.div
              key={origIndex}
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: displayIdx * 0.8, type: "spring", stiffness: 80 }} // Longer delay for sound timing
              onAnimationComplete={() => {
                if (displayIdx < 2) playFanfare(); // 3rd and 2nd get fanfare
                if (displayIdx === 2) playBigCheer(); // 1st gets big cheer + fanfare if wanted
              }}
              className="flex flex-col items-center"
            >
              {/* ... trophy, card, base unchanged */}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}