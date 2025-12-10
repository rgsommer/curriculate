import React, { useEffect, useState } from "react";
import VictoryScreen from "../VictoryScreen";

export default function MusicalChairsTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [scanned, setScanned] = useState(false);
  const [showVictory, setShowVictory] = useState(false);

  // Play sounds and show victory overlay when winnerTeam changes
  useEffect(() => {
    if (!task || !task.winnerTeam) return;

    if (task.winnerTeam === "current") {
      // Winning team sound + overlay
      try {
        new Audio("/sounds/victory.mp3").play();
      } catch (err) {
        console.error("Error playing victory sound:", err);
      }
      setShowVictory(true);
      const timer = setTimeout(() => setShowVictory(false), 5000);
      return () => clearTimeout(timer);
    }

    if (task.winnerTeam !== "eliminated") {
      // Another team wins
      try {
        new Audio("/sounds/lose.mp3").play();
      } catch (err) {
        console.error("Error playing lose sound:", err);
      }
    }
  }, [task?.winnerTeam]);

  const handleScan = () => {
    if (scanned || disabled) return;
    if (!socket || !task?.roomCode) return; // safety guard

    setScanned(true);
    socket.emit("musical-chairs-scan", { roomCode: task.roomCode });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <h2 className="text-4xl font-bold text-red-600 mb-4">
        MUSICAL CHAIRS!
      </h2>

      {task?.question && (
        <div className="mb-6 p-4 bg-yellow-100 rounded-lg border-4 border-yellow-400">
          <p className="text-xl font-semibold">{task.question}</p>

          {Array.isArray(task.options) && task.options.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {task.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onSubmit && onSubmit(opt)}
                  disabled={disabled}
                  className="p-4 bg-white border-2 border-gray-400 rounded-lg font-bold text-lg hover:bg-gray-100"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {typeof task?.stationsLeft === "number" && (
        <div className="text-6xl font-bold text-indigo-700 mb-8">
          {task.stationsLeft} STATIONS LEFT
        </div>
      )}

      <button
        onClick={handleScan}
        disabled={disabled || scanned}
        className={`px-12 py-8 text-4xl font-bold rounded-2xl transition ${
          scanned
            ? "bg-gray-400 text-gray-700"
            : "bg-green-600 text-white hover:bg-green-700 shadow-lg"
        }`}
      >
        {scanned ? "SCANNED!" : "SCAN NOW!"}
      </button>

      {task?.winnerTeam && (
        <div className="mt-8 text-5xl font-bold animate-pulse">
          {task.winnerTeam === "current" ? (
            <span className="text-green-600">YOU WIN! +5</span>
          ) : task.winnerTeam === "eliminated" ? (
            <span className="text-red-600">Eliminated</span>
          ) : (
            <span className="text-orange-600">
              {task.winnerTeam} Wins!
            </span>
          )}
        </div>
      )}

      {showVictory && (
        <VictoryScreen onClose={() => setShowVictory(false)} />
      )}
    </div>
  );
}
