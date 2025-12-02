//student-app/src/components/tasks/types/MadDashSequenceTask.jsx
import React, { useEffect, useState } from "react";
import VictoryScreen from "../VictoryScreen";

const COLORS = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange"];

export default function MadDashSequenceTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [sequence, setSequence] = useState(task.sequence || []);
  const [scanned, setScanned] = useState([]);
  const [showSequence, setShowSequence] = useState(true);
  const [isWinner, setIsWinner] = useState(null);
  const [showVictory, setShowVictory] = useState(false);

  useEffect(() => {
    if (task.sequence && showSequence) {
      const timer = setTimeout(() => setShowSequence(false), 10000);
      return () => clearTimeout(timer);
    }
  }, [task.sequence]);

  useEffect(() => {
    if (task.winnerTeam) {
      if (task.winnerTeam === "current") {
        new Audio("/sounds/victory.mp3").play();
        setIsWinner(true);
        setShowVictory(true);
        setTimeout(() => setShowVictory(false), 5000);
      } else if (task.winnerTeam !== "racing") {
        new Audio("/sounds/lose.mp3").play();
        setIsWinner(false);
      }
    }
  }, [task.winnerTeam]);

  const handleScan = (color) => {
    if (disabled || !showSequence) {
      const nextIndex = scanned.length;
      if (color === sequence[nextIndex]) {
        const newScanned = [...scanned, color];
        setScanned(newScanned);
        socket.emit("mad-dash-scan", {
          roomCode: task.roomCode,
          color,
          isCorrect: true,
        });

        if (newScanned.length === sequence.length) {
          socket.emit("mad-dash-complete", { roomCode: task.roomCode });
        }
      } else {
        socket.emit("mad-dash-scan", {
          roomCode: task.roomCode,
          color,
          isCorrect: false,
        });
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <h2 className="text-6xl font-bold mb-8 text-red-600 animate-pulse">
        MAD DASH – SEQUENCE RACE!
      </h2>

      {showSequence ? (
        <div className="space-y-12">
          <div className="text-5xl font-bold text-indigo-700">
            MEMORIZE THIS SEQUENCE!
          </div>
          <div className="flex gap-8 justify-center text-9xl">
            {sequence.map((color, i) => (
              <div key={i} className="animate-bounce" style={{ animationDelay: `${i * 0.5}s` }}>
                {color}
              </div>
            ))}
          </div>
          <p className="text-2xl text-gray-600 mt-8">Disappears in 10 seconds...</p>
        </div>
      ) : (
        <div className="space-y-12">
          <div className="text-5xl font-bold">
            {scanned.length} / {sequence.length} SCANNED
          </div>

          <div className="flex gap-6 justify-center">
            {COLORS.map(color => (
              <button
                key={color}
                onClick={() => handleScan(color)}
                disabled={disabled || scanned.length >= sequence.length}
                className={`w-32 h-32 rounded-full text-4xl font-bold border-8 transition-all
                  ${scanned.includes(color) ? "opacity-30" : "hover:scale-110 shadow-2xl"}
                  ${color === "Red" ? "bg-red-600" : 
                    color === "Blue" ? "bg-blue-600" :
                    color === "Green" ? "bg-green-600" :
                    color === "Yellow" ? "bg-yellow-500" :
                    color === "Purple" ? "bg-purple-600" :
                    "bg-orange-600"} text-white border-gray-900`}
              >
                {color}
              </button>
            ))}
          </div>

          {isWinner !== null && (
            <div className="text-8xl font-bold animate-bounce mt-12">
              {isWinner ? (
                <span className="text-green-600">YOU WIN! +10</span>
              ) : (
                <span className="text-red-600">TOO SLOW!</span>
              )}
            </div>
          )}
        </div>
      )}
      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}