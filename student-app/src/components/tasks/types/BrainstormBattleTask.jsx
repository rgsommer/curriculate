//student-app/src/components/tasks/types/BrainstormBattleTask.jsx
import React, { useState, useEffect } from "react";

export default function BrainstormBattleTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [ideas, setIdeas] = useState([]);
  const [myIdea, setMyIdea] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [timeLeft, setTimeLeft] = useState(90);
  const [lightningPrompt, setLightningPrompt] = useState(null);
  const [lightningTimer, setLightningTimer] = useState(0);
  const [isMyTurn, setIsMyTurn] = useState(false);

  const seedWords = task.seedWords || ["energy", "motion", "force"];
  const prompt = task.prompt || "What comes to mind?";

  // Main timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 30 && !showOthers) setShowOthers(true);
        if (t <= 1) {
          onSubmit({ ideas });
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [onSubmit]);

  // Lightning Round Listener
  useEffect(() => {
    socket.on("lightning-round", ({ prompt, teamName }) => {
      setLightningPrompt(prompt);
      setLightningTimer(10);
      setIsMyTurn(teamName === "myTeam"); // You'll pass real team name from backend
      const countdown = setInterval(() => {
        setLightningTimer(t => {
          if (t <= 1) {
            setLightningPrompt(null);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(countdown);
    });
  }, [socket]);

  const submitIdea = () => {
    if (!myIdea.trim() || disabled) return;
    const idea = myIdea.trim();
    setIdeas(prev => [...prev, idea]);
    socket.emit("brainstorm-idea", { roomCode: task.roomCode, idea });
    setMyIdea("");
  };

  const answerLightning = () => {
    if (!isMyTurn || !lightningPrompt) return;
    const match = ideas.find(i => i.toLowerCase().includes(lightningPrompt.toLowerCase()));
    socket.emit("lightning-answer", {
      roomCode: task.roomCode,
      answered: !!match,
      idea: match || null,
    });
    setLightningPrompt(null);
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-purple-600 to-pink-600 p-8">
      <h2 className="text-7xl font-bold text-white text-center mb-4 drop-shadow-2xl">
        BRAINSTORM BATTLE!
      </h2>

      {/* Lightning Round Spotlight */}
      {lightningPrompt && (
        <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
          <div className="text-center p-12 bg-yellow-400 rounded-3xl shadow-2xl animate-bounce">
            <h3 className="text-8xl font-bold text-red-600 mb-8">
              GIVE ME A {lightningPrompt.toUpperCase()}!
            </h3>
            <p className="text-9xl font-bold text-white drop-shadow-2xl">
              {lightningTimer}
            </p>
            {isMyTurn && (
              <button
                onClick={answerLightning}
                className="mt-8 px-20 py-10 text-7xl font-bold bg-green-600 text-white rounded-3xl hover:bg-green-700"
              >
                WE HAVE IT!
              </button>
            )}
          </div>
        </div>
      )}

      <div className="text-5xl text-yellow-300 text-center mb-8 animate-pulse">
        {timeLeft}s {timeLeft <= 30 && "— IDEAS VISIBLE!"}
      </div>

      {/* Word Cloud + Input */}
      <div className="flex-1 bg-white rounded-3xl p-8 overflow-y-auto shadow-2xl mb-8">
        <div className="flex flex-wrap gap-4 justify-center">
          {ideas.map((idea, i) => (
            <span key={i} className="px-6 py-3 bg-green-500 text-white rounded-full text-3xl font-bold animate-bounce">
              {idea}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <input
          value={myIdea}
          onChange={e => setMyIdea(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submitIdea()}
          placeholder="Shout your idea!"
          className="flex-1 text-4xl p-6 rounded-2xl border-4 border-white focus:outline-none"
          disabled={disabled}
        />
        <button
          onClick={submitIdea}
          disabled={disabled || !myIdea.trim()}
          className="px-12 py-6 bg-yellow-400 text-purple-900 rounded-2xl text-5xl font-bold hover:bg-yellow-300"
        >
          GO!
        </button>
      </div>
    </div>
  );
}