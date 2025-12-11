// student-app/src/components/tasks/types/BrainBlitzTask.jsx
import React, { useState, useEffect, useRef } from "react";
import VictoryScreen from "../VictoryScreen";

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
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const recognitionRef = useRef(null);

  const clues = Array.isArray(task.clues) ? task.clues : [];
  const currentClue =
    currentClueIndex >= 0 && currentClueIndex < clues.length
      ? clues[currentClueIndex]
      : null;

  // Safe sound playback helper for correct / wrong responses
  const playSound = (src) => {
    try {
      if (typeof Audio !== "undefined") {
        const audio = new Audio(src);
        audio.play().catch(() => {});
      }
    } catch {
      // ignore audio errors
    }
  };

  // Speech Recognition setup – rebinds when the current clue index changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const spoken = event.results[0][0].transcript.trim();

      const clueObj =
        currentClueIndex >= 0 && currentClueIndex < clues.length
          ? clues[currentClueIndex]
          : null;

      const correctAnswer = (clueObj?.answer || "").toLowerCase();
      const spokenLower = spoken.toLowerCase();

      const isCorrect =
        !!correctAnswer &&
        (spokenLower.includes(correctAnswer) ||
          correctAnswer.includes(spokenLower));

      if (isCorrect) {
        setScore((prev) => prev + 100);
        playSound("/sounds/correct.mp3");
      } else {
        playSound("/sounds/wrong.mp3");
      }

      if (socket) {
        socket.emit("brain-blitz-answer", {
          roomCode: task.roomCode,
          clueIndex: currentClueIndex,
          spoken,
          correct: isCorrect,
        });
      }

      // Move to the next clue after each attempt
      setCurrentClueIndex((prev) => prev + 1);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, [clues, currentClueIndex, socket, task.roomCode]);

  // Auto-start listening for each new clue
  useEffect(() => {
    if (!currentClue || disabled) return;
    if (!recognitionRef.current) return;

    const timeout = setTimeout(() => {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        // ignore mic start errors
      }
    }, 1500);

    return () => clearTimeout(timeout);
  }, [currentClue, disabled]);

  // End-of-round: when we've gone past the last clue
  useEffect(() => {
    if (clues.length === 0) return;

    if (currentClueIndex >= clues.length && !hasSubmitted) {
      setHasSubmitted(true);

      if (onSubmit) {
        onSubmit({ finalScore: score });
      }

      // Show the animated VictoryScreen overlay
      setShowVictory(true);
    }
  }, [clues.length, currentClueIndex, hasSubmitted, onSubmit, score]);

  const handleManualStart = () => {
    if (!recognitionRef.current || disabled) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      // ignore
    }
  };

  // If there are no clues at all, show a simple fallback
  if (!clues.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-8">
        <h1 className="text-5xl font-bold mb-4">Brain Blitz</h1>
        <p className="text-xl opacity-80">
          No clues were provided for this round.
        </p>
      </div>
    );
  }

  // Round complete screen (with VictoryScreen overlay on top)
  if (!currentClue && currentClueIndex >= clues.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-yellow-400 to-orange-500 text-white p-8">
        <h1 className="text-6xl md:text-7xl font-black drop-shadow-2xl mb-10">
          BRAIN BLITZ COMPLETE!
        </h1>
        <p className="text-4xl md:text-5xl font-bold">
          Final Score:{" "}
          <span className="text-yellow-300 text-6xl md:text-7xl">
            {score}
          </span>
        </p>

        {showVictory && (
          <VictoryScreen
            variant="random"
            onClose={() => setShowVictory(false)}
          />
        )}
      </div>
    );
  }

  // Main in-round UI
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-indigo-700 via-purple-600 to-pink-600 text-white p-8">
      <h1 className="text-6xl md:text-7xl font-black drop-shadow-2xl mb-10 animate-pulse">
        BRAIN BLITZ!
      </h1>

      <div className="text-center max-w-5xl">
        <p className="text-3xl md:text-4xl mb-6 opacity-80">
          Clue {currentClueIndex + 1} / {clues.length}
        </p>

        <div className="bg-white/20 backdrop-blur-lg rounded-3xl p-10 md:p-16 shadow-2xl">
          <p className="text-4xl md:text-6xl font-bold leading-tight">
            {currentClue?.clue}
          </p>
        </div>

        <div className="mt-12 text-3xl md:text-4xl font-bold animate-pulse flex items-center justify-center gap-6">
          {isListening ? "LISTENING..." : "GET READY..."}
          <span className="text-5xl md:text-7xl">
            {isListening ? "🎙️" : "⚡"}
          </span>
        </div>

        <div className="mt-10 text-3xl md:text-4xl">
          Score:{" "}
          <span className="text-yellow-300 font-black text-4xl md:text-5xl">
            {score}
          </span>
        </div>
      </div>

      {/* Optional manual trigger for devices without auto-start */}
      <button
        type="button"
        onClick={handleManualStart}
        disabled={disabled}
        className="mt-12 px-10 md:px-16 py-4 md:py-6 bg-yellow-400 text-black text-2xl md:text-3xl font-bold rounded-full hover:bg-yellow-300 hover:scale-110 transition disabled:opacity-60 disabled:hover:scale-100"
      >
        SHOUT THE QUESTION!
      </button>

      {showVictory && (
        <VictoryScreen
          variant="random"
          onClose={() => setShowVictory(false)}
        />
      )}
    </div>
  );
}
