// student-app/src/components/tasks/types/BrainBlitzTask.jsx
import React, { useState, useEffect, useRef } from "react";
//import VictoryScreen from "../VictoryScreen";

export default function BrainBlitzTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [isListening, setIsListening] = useState(false);
  const [currentClueIndex, setCurrentClueIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showVictory, setShowVictory] = useState(false);

  const recognitionRef = useRef(null);
  const clues = task.clues || []; // Expected: [{ clue: "This planet is red", answer: "What is Mars?" }, ...]
  const currentClue = clues[currentClueIndex];

  // Speech Recognition Setup
  useEffect(() => {
    if (!("SpeechRecognition" in window || "webkitSpeechRecognition" in window)) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    recognitionRef.current.lang = "en-US";

    recognitionRef.current.onresult = (event) => {
      const spoken = event.results[0][0].transcript.trim();
      const correctAnswer = currentClue?.answer?.toLowerCase() || "";

      const isCorrect = spoken.toLowerCase().includes(correctAnswer) || 
                        correctAnswer.includes(spoken.toLowerCase());

      if (isCorrect) {
        setScore(s => s + 100);
        new Audio("/sounds/correct.mp3").play();
      } else {
        new Audio("/sounds/wrong.mp3").play();
      }

      socket.emit("brain-blitz-answer", {
        roomCode: task.roomCode,
        clueIndex: currentClueIndex,
        spoken,
        correct: isCorrect,
      });
    };

    recognitionRef.current.onend = () => setIsListening(false);

    return () => recognitionRef.current?.stop();
  }, [currentClueIndex, currentClue]);

  // Auto-start listening for each new clue
  useEffect(() => {
    if (!currentClue || disabled) return;
    const timeout = setTimeout(() => {
      recognitionRef.current?.start();
      setIsListening(true);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [currentClue, disabled]);

  // End of round
  useEffect(() => {
    if (currentClueIndex >= clues.length && clues.length > 0) {
      setTimeout(() => {
        onSubmit({ finalScore: score });
        setShowVictory(true);
        new Audio("/sounds/victory.mp3").play();
        setTimeout(() => setShowVictory(false), 6000);
      }, 2000);
    }
  }, [currentClueIndex, clues.length, score, onSubmit]);

  if (!currentClue) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-yellow-400 to-orange-500">
        <h1 className="text-9xl font-black text-white drop-shadow-2xl animate-bounce">
          BRAIN BLITZ COMPLETE!
        </h1>
        <p className="text-7xl mt-12 text-white font-bold">
          Final Score: <span className="text-yellow-300">{score}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-indigo-700 via-purple-600 to-pink-600 text-white p-8">
      <h1 className="text-9xl font-black drop-shadow-2xl mb-12 animate-pulse">
        BRAIN BLITZ!
      </h1>

      <div className="text-center max-w-5xl">
        <p className="text-5xl mb-8 opacity-80">
          Clue {currentClueIndex + 1} / {clues.length}
        </p>

        <div className="bg-white/20 backdrop-blur-lg rounded-3xl p-16 shadow-2xl">
          <p className="text-7xl md:text-8xl font-bold leading-tight">
            {currentClue.clue}
          </p>
        </div>

        <div className="mt-16 text-6xl font-bold animate-pulse flex items-center gap-6">
          {isListening ? "LISTENING..." : "GET READY..."}
          <span className="text-9xl">{isListening ? "MICROPHONE" : "LIGHTNING"}</span>
        </div>

        <div className="mt-12 text-5xl">
          Score: <span className="text-yellow-300 font-black text-7xl">{score}</span>
        </div>
      </div>

      {/* Optional manual trigger for devices without auto-start */}
      <button
        onClick={() => recognitionRef.current?.start()}
        className="mt-12 px-16 py-8 bg-yellow-400 text-black text-6xl font-bold rounded-full hover:bg-yellow-300 hover:scale-110 transition"
      >
        SHOUT THE QUESTION!
      </button>

      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}