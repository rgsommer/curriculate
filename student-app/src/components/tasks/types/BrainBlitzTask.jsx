// student-app/src/components/tasks/types/BrainBlitzTask.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import VictoryScreen from "../../VictoryScreen";

export default function BrainBlitzTask({ task, onSubmit, disabled, socket }) {
  const [isListening, setIsListening] = useState(false);
  const [currentClueIndex, setCurrentClueIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showVictory, setShowVictory] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // NEW: a simple “ready” countdown before we start listening
  const [countdown, setCountdown] = useState(null); // null | 3..0

  const recognitionRef = useRef(null);

  const raw = useMemo(() => {
    return (
      (Array.isArray(task?.config?.clues) && task.config.clues) ||
      (Array.isArray(task?.clues) && task.clues) ||
      (Array.isArray(task?.questions) && task.questions) ||
      (Array.isArray(task?.items) && task.items) ||
      []
    );
  }, [task]);

  const clues = useMemo(() => {
    return raw
      .map((x) => ({
        clue: x.clue ?? x.prompt ?? x.question ?? x.text ?? "",
        answer: x.answer ?? x.correctAnswer ?? x.correct ?? "",
      }))
      .filter((x) => String(x.clue).trim().length > 0);
  }, [raw]);

  const currentClue =
    currentClueIndex >= 0 && currentClueIndex < clues.length
      ? clues[currentClueIndex]
      : null;

  const total = clues.length || 1;
  const progress = Math.min(1, Math.max(0, currentClueIndex / total));

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
      const spoken = event.results?.[0]?.[0]?.transcript?.trim?.() || "";

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

      setCountdown(null);
      setIsListening(false);

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

  // Auto-start listening for each new clue (with a short countdown)
  useEffect(() => {
    if (!currentClue || disabled) return;
    if (!recognitionRef.current) return;

    // start a 3..2..1 countdown, then start listening
    setCountdown(3);
    setIsListening(false);

    const tick = () => {
      setCountdown((c) => {
        if (c == null) return null;
        if (c <= 1) return 0;
        return c - 1;
      });
    };

    const timer = setInterval(tick, 650);

    const start = setTimeout(() => {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        // ignore mic start errors
      }
    }, 2100); // ~3 ticks

    const clear = setTimeout(() => {
      setCountdown(null);
      clearInterval(timer);
    }, 2300);

    return () => {
      clearTimeout(start);
      clearTimeout(clear);
      clearInterval(timer);
    };
  }, [currentClue, disabled]);

  // End-of-round: when we've gone past the last clue
  useEffect(() => {
    if (clues.length === 0) return;

    if (currentClueIndex >= clues.length && !hasSubmitted) {
      setHasSubmitted(true);

      if (onSubmit) onSubmit({ finalScore: score });

      // Show the animated VictoryScreen overlay
      setShowVictory(true);
    }
  }, [clues.length, currentClueIndex, hasSubmitted, onSubmit, score]);

  const handleManualStart = () => {
    if (!recognitionRef.current || disabled) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      setCountdown(null);
    } catch {
      // ignore
    }
  };

  // If there are no clues at all, show a simple fallback
  if (!clues.length) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-3xl border bg-white p-6 shadow">
          <div className="text-sm font-bold text-gray-600 mb-2">Brain Blitz</div>
          <div className="text-2xl font-extrabold mb-2">No clues provided</div>
          <div className="text-gray-700 opacity-80">
            This round didn’t include any clues.
          </div>
        </div>
      </div>
    );
  }

  // Round complete screen (with VictoryScreen overlay on top)
  if (!currentClue && currentClueIndex >= clues.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-yellow-400 to-orange-500 text-white p-8">
        <div className="text-xs font-black tracking-widest bg-black/20 px-4 py-2 rounded-full mb-6">
          ROUND COMPLETE
        </div>

        <h1 className="text-5xl md:text-6xl font-black drop-shadow-2xl mb-6 text-center">
          Brain Blitz Complete!
        </h1>

        <p className="text-3xl md:text-4xl font-bold">
          Final Score:{" "}
          <span className="text-yellow-200 text-5xl md:text-6xl font-black">
            {score}
          </span>
        </p>

        {showVictory && (
          <VictoryScreen variant="random" onClose={() => setShowVictory(false)} />
        )}
      </div>
    );
  }

  const statusLabel = isListening
    ? "LISTENING…"
    : countdown != null && countdown > 0
      ? `GET READY… ${countdown}`
      : "GET READY…";

  const statusIcon = isListening ? "🎙️" : "⚡";

  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-6">
      <style>{`
        @keyframes bbPulse {
          0%,100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.03); opacity: 0.95; }
        }
      `}</style>

      <div className="w-full max-w-5xl">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="text-xs font-black tracking-widest px-3 py-1 rounded-full border bg-white">
              BRAIN BLITZ
            </div>
            <div className="text-sm text-gray-600">
              Clue <span className="font-bold">{currentClueIndex + 1}</span> /{" "}
              <span className="font-bold">{clues.length}</span>
            </div>
          </div>

          <div className="text-sm font-extrabold px-3 py-1 rounded-full border bg-white">
            Score: <span className="ml-1">{score}</span>
          </div>
        </div>

        {/* Progress */}
        <div className="h-3 rounded-full border bg-white overflow-hidden mb-5">
          <div
            className="h-full"
            style={{
              width: `${Math.round(progress * 100)}%`,
              background: "linear-gradient(90deg, #7c3aed, #ec4899)",
            }}
          />
        </div>

        {/* Clue card */}
        <div className="rounded-3xl border bg-white shadow p-5 md:p-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="text-sm font-bold text-gray-600">
              Read the clue out loud…
            </div>

            <div
              className="px-4 py-2 rounded-full font-extrabold border bg-gray-50 flex items-center gap-2"
              style={{ animation: "bbPulse 1.2s ease-in-out infinite" }}
            >
              <span>{statusIcon}</span>
              <span>{statusLabel}</span>
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 text-white p-6 md:p-10">
            <div className="text-2xl md:text-4xl font-black leading-tight">
              {currentClue?.clue}
            </div>
          </div>

          <div className="mt-4 text-sm text-gray-600">
            Tip: Speak clearly. Short answers work best.
          </div>
        </div>

        {/* Controls */}
        <div className="mt-5 flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <button
            type="button"
            onClick={handleManualStart}
            disabled={disabled}
            className="flex-1 px-6 py-4 rounded-2xl border bg-white font-extrabold hover:shadow transition disabled:opacity-60"
          >
            {isListening ? "Listening…" : "Tap to Start 🎙️"}
          </button>

          <div className="flex-1 rounded-2xl border bg-gray-50 px-4 py-4 text-sm text-gray-700">
            <div className="font-bold mb-1">Teacher-friendly setup</div>
            <div className="opacity-80">
              Auto-starts each clue (with a quick countdown). Manual start is here
              for devices that block mic auto-start.
            </div>
          </div>
        </div>

        {showVictory && (
          <VictoryScreen variant="random" onClose={() => setShowVictory(false)} />
        )}
      </div>
    </div>
  );
}
