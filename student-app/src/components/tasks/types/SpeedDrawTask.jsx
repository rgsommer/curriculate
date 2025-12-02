//student-app/src/components/tasks/types/SpeedDrawTask.jsx
import React, { useState, useEffect } from "react";
//import VictoryScreen from "../VictoryScreen";

export default function SpeedDrawTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [selected, setSelected] = useState(null);
  const [locked, setLocked] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [winner, setWinner] = useState(task.winner);
  const [showVictory, setShowVictory] = useState(false);

  const { question, options, correctIndex } = task;

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => (t <= 0 ? 0 : t - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (task.winner) {
      setWinner(task.winner);
      if (task.winner === "myTeam") {
        new Audio("/sounds/victory.mp3").play();
        setShowVictory(true);
        setTimeout(() => setShowVictory(false), 5000);
      } else if (task.winner !== "none") {
        new Audio("/sounds/wrong.mp3").play();
      }
    }
  }, [task.winner]);

  const choose = (index) => {
    if (disabled || locked || winner) return;
    setSelected(index);
    setLocked(true);

    const isCorrect = index === correctIndex;
    socket.emit("speed-draw-answer", {
      roomCode: task.roomCode,
      index,
      correct: isCorrect,
    });

    if (isCorrect) {
      onSubmit({ correct: true });
    } else {
      setTimeout(() => setLocked(false), 5000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-red-600 to-purple-700">
      <h2 className="text-8xl font-bold text-white mb-8 drop-shadow-2xl animate-pulse">
        SPEED DRAW!
      </h2>

      <div className="text-9xl text-yellow-400 mb-8 font-bold">
        {timeLeft}
      </div>

      <p className="text-6xl text-white text-center font-bold mb-12 max-w-5xl">
        {question}
      </p>

      <div className="grid grid-cols-2 gap-12 max-w-4xl">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => choose(i)}
            disabled={disabled || locked || winner}
            className={`p-16 text-6xl font-bold rounded-3xl transition-all transform
              ${selected === i 
                ? i === correctIndex 
                  ? "bg-green-500 text-white scale-110 ring-8 ring-green-300" 
                  : "bg-red-600 text-white ring-8 ring-red-400"
                : "bg-white text-gray-800 hover:scale-105 hover:shadow-2xl"
              } ${locked && selected !== i ? "opacity-50" : ""}
              ${winner ? "cursor-not-allowed" : "cursor-pointer"}
            `}
          >
            {String.fromCharCode(65 + i)}. {opt}
          </button>
        ))}
      </div>

      {winner && (
        <div className="mt-16 text-9xl font-bold text-yellow-300 animate-bounce">
          {winner === "myTeam" ? "YOU WIN! +25" : `${winner} WINS!`}
        </div>
      )}
      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}