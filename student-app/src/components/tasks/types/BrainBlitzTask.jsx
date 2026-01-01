// student-app/src/components/tasks/types/BrainBlitzTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import VictoryScreen from "../../VictoryScreen";
import { TaskCardFrame, Pill, PrimaryButton } from "../taskStyles";

/**
 * Brain Blitz (standard UI)
 * - Shows clues one-by-one
 * - SpeechRecognition (or manual button) to capture a shouted question
 * - Renders guesses live as they are received (local + socket broadcast)
 * - Confetti burst on correct guess (more obvious than a brief flash)
 *
 * NOTE: We listen to multiple possible socket event names to be resilient:
 *   - "brain-blitz-answer"
 *   - "brain-blitz-answer-broadcast"
 */
export default function BrainBlitzTask({ task, onSubmit, disabled, socket }) {
  const [isListening, setIsListening] = useState(false);
  const [currentClueIndex, setCurrentClueIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showVictory, setShowVictory] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // “Get ready…” staging
  const [countdown, setCountdown] = useState(null); // null | 3..0

  // Live guess feed (render exactly as received)
  const [guessFeed, setGuessFeed] = useState([]); // newest last
  const lastGuessKeysRef = useRef(new Set());

  // Confetti moment on a correct guess
  const [celebrateKey, setCelebrateKey] = useState(null);

  const recognitionRef = useRef(null);

  const clues = useMemo(() => {
    const raw =
      (Array.isArray(task?.clues) && task.clues) ||
      (Array.isArray(task?.config?.clues) && task.config.clues) ||
      [];
    return raw
      .map((c, idx) => {
        if (typeof c === "string") return { clue: c, answer: "" };
        if (c && typeof c === "object") {
          const clue = String(c.clue ?? c.prompt ?? c.text ?? c.question ?? `Clue ${idx + 1}`).trim();
          const answer = String(c.answer ?? c.solution ?? c.correctAnswer ?? "").trim();
          return { clue, answer };
        }
        return { clue: `Clue ${idx + 1}`, answer: "" };
      })
      .filter((c) => c && c.clue);
  }, [task]);

  const currentClue =
    currentClueIndex >= 0 && currentClueIndex < clues.length ? clues[currentClueIndex] : null;

  function playSound(src) {
    try {
      const a = new Audio(src);
      a.volume = 0.55;
      a.play().catch(() => {});
    } catch {
      // ignore
    }
  }

  function pushGuess({ by, spoken, correct, clueIndex }) {
    const safeBy = String(by || "Team").slice(0, 32);
    const safeSpoken = String(spoken || "").trim().slice(0, 120);
    const key = `${clueIndex ?? "?"}|${safeBy}|${safeSpoken}|${correct ? 1 : 0}`;

    // De-dupe quick duplicates (e.g., local echo from server)
    if (lastGuessKeysRef.current.has(key)) return;
    lastGuessKeysRef.current.add(key);
    // Cap the de-dupe cache
    if (lastGuessKeysRef.current.size > 60) {
      const arr = Array.from(lastGuessKeysRef.current);
      lastGuessKeysRef.current = new Set(arr.slice(arr.length - 40));
    }

    setGuessFeed((prev) => {
      const next = [...prev, { by: safeBy, spoken: safeSpoken, correct: !!correct, clueIndex: clueIndex ?? currentClueIndex, ts: Date.now() }];
      // Keep last 10
      return next.length > 10 ? next.slice(next.length - 10) : next;
    });
  }

  function triggerCelebrate() {
    setCelebrateKey(`c_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    // little celebratory sound if you have it; otherwise ignore
    playSound("/sounds/victory.mp3");
  }

  // --- Speech recognition setup ------------------------------------------------
  useEffect(() => {
    if (disabled) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const spoken = event?.results?.[0]?.[0]?.transcript?.trim?.() || "";

      const clueObj =
        currentClueIndex >= 0 && currentClueIndex < clues.length
          ? clues[currentClueIndex]
          : null;

      const correctAnswer = (clueObj?.answer || "").toLowerCase();
      const spokenLower = String(spoken).toLowerCase();

      const isCorrect =
        !!correctAnswer &&
        (spokenLower.includes(correctAnswer) || correctAnswer.includes(spokenLower));

      // Render the guess immediately (local)
      pushGuess({ by: "You", spoken, correct: isCorrect, clueIndex: currentClueIndex });

      if (isCorrect) {
        setScore((prev) => prev + 100);
        playSound("/sounds/correct.mp3");
        triggerCelebrate();
      } else {
        playSound("/sounds/wrong.mp3");
      }

      if (socket) {
        socket.emit("brain-blitz-answer", {
          roomCode: task?.roomCode,
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

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clues, currentClueIndex, socket, task?.roomCode, disabled]);

  // --- Socket listener: show guesses exactly as received -----------------------
  useEffect(() => {
    if (!socket) return;

    const handle = (payload) => {
      if (!payload) return;
      // Some servers may use { teamName } or { team }
      const by = payload.teamName || payload.team || payload.by || "Team";
      const spoken = payload.spoken || payload.answer || payload.text || "";
      const correct = !!payload.correct;
      const clueIndex = Number.isFinite(Number(payload.clueIndex)) ? Number(payload.clueIndex) : undefined;

      pushGuess({ by, spoken, correct, clueIndex });

      if (correct) {
        triggerCelebrate();
      }
    };

    socket.on("brain-blitz-answer", handle);
    socket.on("brain-blitz-answer-broadcast", handle);

    return () => {
      try { socket.off("brain-blitz-answer", handle); } catch {}
      try { socket.off("brain-blitz-answer-broadcast", handle); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

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

  // ---------------- UI ----------------

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
    <TaskCardFrame
      theme="light"
      badge="⚡ Brain Blitz"
      title="SHOUT THE QUESTION!"
      subtitle={statusLabel}
      right={right}
      style={{
        background:
          "radial-gradient(900px 380px at 20% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(900px 380px at 80% 0%, rgba(236,72,153,0.14), transparent 60%), linear-gradient(135deg, rgba(238,242,255,1), rgba(255,255,255,1))",
      }}
    >
      <style>{`
        @keyframes bbConfettiFall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(280px) rotate(360deg); opacity: 0; }
        }
        @keyframes bbPop {
          0% { transform: scale(0.92); opacity: 0; }
          15% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>

      {/* Confetti burst overlay */}
      {celebrateKey && (
        <div
          key={celebrateKey}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
            borderRadius: 28,
          }}
        >
          {/* big obvious banner */}
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "10px 14px",
              borderRadius: 16,
              background: "rgba(34,197,94,0.14)",
              border: "1px solid rgba(34,197,94,0.35)",
              color: "#065f46",
              fontWeight: 950,
              letterSpacing: 0.4,
              animation: "bbPop 1100ms ease-out forwards",
            }}
          >
            ✅ Correct!
          </div>

          {Array.from({ length: 28 }).map((_, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                top: -10,
                left: `${(i * 97) % 100}%`,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a78bfa"][i % 5],
                animation: `bbConfettiFall ${900 + (i % 8) * 120}ms ease-in forwards`,
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            padding: 16,
            borderRadius: 18,
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(15,23,42,0.12)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.7, marginBottom: 6 }}>
            Clue {currentClueIndex + 1} / {clues.length}
          </div>
          <div style={{ fontSize: 22, fontWeight: 950, lineHeight: 1.2 }}>
            {currentClue?.clue}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Pill theme="light" subtle>
            🎤 {isListening ? "Listening for your shout…" : "Ready for your shout"}
          </Pill>

          {!isListening && recognitionRef.current && (
            <PrimaryButton onClick={handleManualStart} disabled={disabled}>
              Start Mic
            </PrimaryButton>
          )}

          {!recognitionRef.current && (
            <Pill theme="light">Mic not available (no SpeechRecognition)</Pill>
          )}
        </div>

        {/* Guess feed */}
        <div
          style={{
            padding: 14,
            borderRadius: 18,
            background: "rgba(15,23,42,0.04)",
            border: "1px dashed rgba(15,23,42,0.18)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 950 }}>Live guesses</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Shows exactly what was heard</div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {guessFeed.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No guesses yet — be the first to shout! ⚡</div>
            ) : (
              guessFeed
                .slice()
                .reverse()
                .map((g, idx) => (
                  <div
                    key={`${g.ts}_${idx}`}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "8px 10px",
                      borderRadius: 14,
                      background: g.correct ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.08)",
                      border: g.correct
                        ? "1px solid rgba(34,197,94,0.28)"
                        : "1px solid rgba(15,23,42,0.10)",
                    }}
                  >
                    <div style={{ minWidth: 34, fontWeight: 950 }}>
                      {g.correct ? "✅" : "💬"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 850, fontSize: 13, opacity: 0.85 }}>
                        {g.by} {Number.isFinite(g.clueIndex) ? `• clue ${g.clueIndex + 1}` : ""}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.spoken || "(inaudible)"}
                      </div>
                    </div>
                    {g.correct && <Pill theme="light">+100</Pill>}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </TaskCardFrame>
  );
}
