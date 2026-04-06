// src/components/Leaderboard.jsx
import React from "react";
import { motion } from "framer-motion";
import Confetti from "react-confetti";

const trophyEmojis = ["🥇", "🥈", "🥉"];

export default function AnimatedLeaderboard({ leaderboard = [], showConfetti = false, currentTeamName }) {
  return (
    <div className="relative w-full max-w-md mx-auto p-6 bg-gradient-to-b from-purple-600 to-blue-800 rounded-3xl shadow-2xl overflow-hidden">
      {showConfetti && <Confetti width={window.innerWidth} height={400} recycle={false} numberOfPieces={300} gravity={0.2} />}
      
      <h2 className="text-3xl font-bold text-white text-center mb-6 drop-shadow-lg">
        🏆 Live Leaderboard 🏆
      </h2>

      <div className="space-y-4">
        {leaderboard.map((team, index) => (
          <motion.div
            key={team.teamName}
            initial={{ opacity: 0, x: -100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: index * 0.1, type: "spring", stiffness: 100 }}
            whileHover={{ scale: 1.05, boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}
            className={`relative flex items-center justify-between p-4 rounded-2xl text-white font-bold text-xl
              ${currentTeamName === team.teamName ? "ring-4 ring-yellow-400 bg-opacity-90" : ""}
              ${index === 0 ? "bg-yellow-500" : index === 1 ? "bg-gray-400" : index === 2 ? "bg-orange-600" : "bg-white bg-opacity-20"}`}
          >
            {/* Podium Trophy for Top 3 */}
            <div className="absolute -left-4 text-5xl">
              {index < 3 ? trophyEmojis[index] : `${index + 1}.`}
            </div>

            {/* Rank Change Indicator */}
            {team.rankChange > 0 && (
              <motion.span
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="absolute -top-4 right-4 text-green-400 text-2xl"
              >
                ⬆ {team.rankChange}
              </motion.span>
            )}
            {team.rankChange < 0 && (
              <motion.span
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="absolute -top-4 right-4 text-red-400 text-2xl"
              >
                ⬇ {Math.abs(team.rankChange)}
              </motion.span>
            )}

            <span className="ml-12" style={{ marginRight: 12 }}>{team.teamName}</span>
            <span className="text-3xl">{team.score} pts</span>
          </motion.div>
        ))}
      </div>

      {leaderboard.length === 0 && (
        <p className="text-center text-white text-lg mt-8">No scores yet—start playing! 🚀</p>
      )}
    </div>
  );
}