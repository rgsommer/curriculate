// student-app/src/components/tasks/types/BrainBlitzTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import VictoryScreen from "../../VictoryScreen";
import { TaskCardFrame, Pill, GhostButton } from "../taskStyles";

export default function BrainBlitzTask({ task, onSubmit, disabled, socket }) {
  const [isListening, setIsListening] = useState(false);
  const [currentClueIndex, setCurrentClueIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showVictory, setShowVictory] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const [countdown, setCountdown] = useState(null); // null | 3..0
  const recognitionRef = useRef(null);

  const raw = useMemo(() => {
    return (
      (Array.isArray(task?.config?.clues) && task.config.clues) ||
      (Array.isArray(task?.clues) && task.clues) ||
      (Array.isArray(task?.questions) && task.questions) ||
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

  const total = Math.max(1, clues.length);
  const progress = Math.min(1, Math.max(0, currentClueIndex / total));

  const playSound = (src) => {
    try {
      if (typeof Audio !== "undefined") {
        const audio = new Audio(src);
        audio.volume = 0.35;
        audio.play().catch(() => {});
      }
    } catch {}
  };

  // Speech Recognition setup
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript?.trim?.() || "";

      const clueObj =
        currentClueIndex >= 0 && currentClueIndex < clues.length ? clues[currentClueIndex] : null;

      const correctAnswer = (clueObj?.answer || "").toLowerCase().trim();
      const spokenLower = spoken.toLowerCase().trim();

      const isCorrect =
        !!correctAnswer &&
        (spokenLower.includes(correctAnswer) || correctAnswer.includes(spokenLower));

      if (isCorrect) {
        setScore((prev) => prev + 100);
        playSound("/sounds/correct.mp3");
      } else {
        playSound("/sounds/wrong.mp3");
      }

      socket?.emit?.("brain-blitz-answer", {
        roomCode: task?.roomCode,
        clueIndex: currentClueIndex,
        spoken,
        correct: isCorrect,
      });

      setCountdown(null);
      setIsListening(false);
      setCurrentClueIndex((prev) => prev + 1);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [clues, currentClueIndex, socket, task?.roomCode]);

  // Auto-start listening for each new clue (with countdown)
  useEffect(() => {
    if (!currentClue || disabled) return;
    if (!recognitionRef.current) return;

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
      } catch {}
    }, 2100);

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

  // End-of-round
  useEffect(() => {
    if (!clues.length) return;
    if (currentClueIndex >= clues.length && !hasSubmitted) {
      setHasSubmitted(true);
      onSubmit?.({ finalScore: score });
      setShowVictory(true);
    }
  }, [clues.length, currentClueIndex, hasSubmitted, onSubmit, score]);

  const handleManualStart = () => {
    if (!recognitionRef.current || disabled) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      setCountdown(null);
    } catch {}
  };

  const statusLabel = isListening
    ? "Listening…"
    : countdown != null && countdown > 0
    ? `Get ready… ${countdown}`
    : "Get ready…";

  const right = (
    <>
      <Pill theme="light">🧩 Clue {Math.min(clues.length, currentClueIndex + 1)} / {clues.length || 0}</Pill>
      <Pill theme="light">🏆 Score {score}</Pill>
    </>
  );

  if (!clues.length) {
    return (
      <TaskCardFrame theme="light" badge="⚡ Brain Blitz" title="No clues provided" subtitle="This round didn’t include any clues.">
        <div style={{ color: "rgba(15,23,42,0.74)", fontWeight: 850 }}>
          Check the task JSON and ensure it includes <b>clues</b>.
        </div>
      </TaskCardFrame>
    );
  }

  if (!currentClue && currentClueIndex >= clues.length) {
    return (
      <TaskCardFrame
        theme="light"
        badge="🏁 Round Complete"
        title="Brain Blitz Complete!"
        subtitle="Final Score"
        right={<Pill theme="light">🏆 {score}</Pill>}
      >
        {showVictory && <VictoryScreen variant="random" onClose={() => setShowVictory(false)} />}
      </TaskCardFrame>
    );
  }

  return (
    <TaskCardFrame theme="light" badge="⚡ Brain Blitz" title="Shout the answer!" subtitle={statusLabel} right={right}>
      <style>{`
        @keyframes bbGlow { 0%,100% { box-shadow: 0 0 0 rgba(99,102,241,0.0); } 50% { box-shadow: 0 0 38px rgba(236,72,153,0.22); } }
        .bb-status { animation: bbGlow 1.6s ease-in-out infinite; }
      `}</style>

      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "rgba(15,23,42,0.08)",
          border: "1px solid rgba(15,23,42,0.08)",
          overflow: "hidden",
        }}
        aria-label="Progress"
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(progress * 100)}%`,
            background: "linear-gradient(90deg, rgba(99,102,241,0.95), rgba(236,72,153,0.85))",
            transition: "width 220ms linear",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          borderRadius: 24,
          border: "1px solid rgba(15,23,42,0.10)",
          background: "linear-gradient(135deg, rgba(15,23,42,0.92), rgba(15,23,42,0.82))",
          boxShadow: "0 26px 80px rgba(15,23,42,0.22)",
          color: "#fff",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 14,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 950, opacity: 0.9 }}>Clue</div>

          <div
            className="bb-status"
            style={{
              padding: "10px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.10)",
              fontWeight: 1000,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span aria-hidden="true">{isListening ? "🎙️" : "⚡"}</span>
            <span style={{ letterSpacing: 0.2 }}>{statusLabel}</span>
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div
            style={{
              fontSize: "clamp(22px, 3.2vw, 44px)",
              fontWeight: 1100,
              lineHeight: 1.08,
              textShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            {currentClue?.clue}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, fontWeight: 850 }}>
            Tip: Speak clearly. If your device blocks auto-mic, tap the button below.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <GhostButton onClick={handleManualStart} disabled={disabled} theme="light" style={{ padding: "12px 14px" }}>
          {isListening ? "Listening…" : "Tap to Start 🎙️"}
        </GhostButton>
      </div>

      {showVictory && <VictoryScreen variant="random" onClose={() => setShowVictory(false)} />}
    </TaskCardFrame>
  );
}
