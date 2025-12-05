// student-app/src/components/tasks/types/BrainstormBattleTask.jsx
import React, { useState, useEffect, useRef } from "react";
import Confetti from "react-confetti";

export default function BrainstormBattleTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [myIdeas, setMyIdeas] = useState([]);
  const [allTeams, setAllTeams] = useState({});
  const [myTeamColor] = useState(task.myTeamColor || "Blue");
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(90);
  const [isListening, setIsListening] = useState(false);

  // DRAMATIC STEAL STATE
  const [stealDrama, setStealDrama] = useState(null); // { from: "Red", idea: "laser", success: true }

  const recognitionRef = useRef(null);

  // Timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // Speech Recognition (unchanged)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const startListening = () => {
    if (!SpeechRecognition || disabled) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const spoken = event.results[0][0].transcript.trim().toLowerCase();
      if (spoken && !myIdeas.includes(spoken)) {
        setMyIdeas(prev => [...prev, spoken]);
        socket.emit("brainstorm-idea", { roomCode: task.roomCode, idea: spoken });
      }
    };

    recognition.start();
    setIsListening(true);
    recognitionRef.current = recognition;
    recognition.onend = () => setIsListening(false);
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  // Socket listeners
  useEffect(() => {
    socket.on("brainstorm-update", ({ teams, scores }) => {
      setAllTeams(teams);
      if (scores?.[myTeamColor]) setScore(scores[myTeamColor]);
    });

    // THIS IS WHERE THE DRAMA HAPPENS
    socket.on("steal-response", ({ fromTeam, idea, success }) => {
      setStealDrama({ from: fromTeam, idea, success });

      // Play epic sound
      new Audio(success ? "/sounds/epic-win.mp3" : "/sounds/epic-fail.mp3").play();

      // Auto-clear after 5 seconds
      setTimeout(() => setStealDrama(null), 5000);
    });

    return () => {
      socket.off("brainstorm-update");
      socket.off("steal-response");
    };
  }, [socket, myTeamColor]);

  const requestSteal = (fromTeam) => {
    if (disabled || timeLeft <= 0) return;
    socket.emit("brainstorm-steal-request", { roomCode: task.roomCode, fromTeam });
  };

  // Team color → Tailwind class
  const teamColorClass = (color) => {
    const map = {
      Blue: "from-blue-600 to-cyan-500",
      Red: "from-red-600 to-pink-500",
      Green: "from-green-600 to-emerald-500",
      Yellow: "from-yellow-500 to-amber-500",
      Purple: "from-purple-600 to-pink-600",
      Orange: "from-orange-600 to-red-500",
    };
    return map[color] || "from-gray-600 to-gray-400";
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-indigo-800 via-purple-700 to-pink-700 text-white overflow-hidden">
      {/* Header */}
      <h1 className="text-7xl md:text-9xl font-black mb-8 drop-shadow-2xl animate-pulse">
        BRAINSTORM BATTLE!
      </h1>

      {/* Timer & Score */}
      <div className="flex gap-16 text-6xl font-bold mb-8 z-10">
        <div>Time: <span className={`font-black ${timeLeft < 20 ? "text-red-500 animate-pulse" : "text-white"}`}>{timeLeft}s</span></div>
        <div>Score: <span className="text-yellow-400 font-black text-8xl">{score}</span></div>
      </div>

      {/* My Ideas */}
      <div className="bg-white/20 backdrop-blur-lg rounded-3xl p-8 w-full max-w-4xl mb-8 z-10">
        <p className="text-4xl font-bold mb-4">My Ideas ({myIdeas.length})</p>
        <div className="flex flex-wrap gap-4">
          {myIdeas.map((idea, i) => (
            <span key={i} className="px-6 py-3 bg-yellow-400 text-black rounded-full text-2xl font-bold shadow-lg">
              {idea}
            </span>
          ))}
        </div>
      </div>

      {/* OTHER TEAMS – STEAL BUBBLES */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-8 z-10">
        {Object.entries(allTeams)
          .filter(([color]) => color !== myTeamColor)
          .map(([color, ideas]) => (
            <button
              key={color}
              onClick={() => requestSteal(color)}
              disabled={disabled || timeLeft <= 0}
              className="group relative"
            >
              <div className={`w-36 h-36 rounded-full shadow-2xl transition-all hover:scale-150 hover:rotate-12
                bg-gradient-to-br ${teamColorClass(color)}`}>
                <div className="flex flex-col items-center justify-center h-full">
                  <span className="text-6xl font-black">{ideas.length}</span>
                  <span className="text-3xl font-bold">{color}</span>
                </div>
              </div>
              <div className="absolute inset-0 rounded-full bg-white/30 animate-ping group-hover:animate-none" />
              <div className="absolute -inset-2 rounded-full bg-white/20 animate-pulse group-hover:animate-none" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl font-bold opacity-0 group-hover:opacity-100 transition">
                STEAL!
              </div>
            </button>
          ))}
      </div>

      {/* EPIC STEAL FEEDBACK – FULL SCREEN DRAMA */}
      {stealDrama && (
        <>
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            recycle={false}
            numberOfPieces={600}
            gravity={0.3}
            colors={stealDrama.success 
              ? ["#10b981", "#34d399", "#6ee7b7", "#86efac"] 
              : ["#ef4444", "#f87171", "#fca5a5"]}
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className={`text-center animate__animated animate__zoomIn animate__faster ${stealDrama.success ? "text-green-400" : "text-red-500"}`}>
              <p className="text-9xl md:text-12xl font-black drop-shadow-2xl mb-8">
                {stealDrama.success ? "YOU STOLE IT!" : "THEY STOLE IT!"}
              </p>
              <p className="text-7xl md:text-10xl font-black mb-8 drop-shadow-2xl">
                "{stealDrama.idea.toUpperCase()}"
              </p>
              <p className="text-8xl md:text-11xl font-black animate-bounce">
                {stealDrama.success ? "+10 POINTS!" : `${stealDrama.from} +10!`}
              </p>
            </div>
          </div>
          {/* Screen shake effect */}
          <style jsx>{`
            @keyframes shake {
              0%, 100% { transform: translateX(0); }
              10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
              20%, 40%, 60%, 80% { transform: translateX(10px); }
            }
            .shake { animation: shake 0.5s ease-in-out; }
          `}</style>
          <div className="fixed inset-0 shake" />
        </>
      )}

      {/* Mic Button */}
      <button
        onClick={isListening ? stopListening : startListening}
        disabled={disabled || timeLeft <= 0}
        className={`fixed bottom-12 left-1/2 -translate-x-1/2 w-44 h-44 rounded-full shadow-2xl transition-all z-30
          ${isListening 
            ? "bg-red-600 animate-pulse ring-16 ring-red-400 scale-110" 
            : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:scale-125"
          }`}
      >
        <span className="text-10xl">{isListening ? "Stop" : "Mic"}</span>
      </button>

      {isListening && (
        <p className="fixed inset-0 flex items-center justify-center text-9xl font-bold text-white animate-pulse pointer-events-none z-20">
          LISTENING...
        </p>
      )}
    </div>
  );
}