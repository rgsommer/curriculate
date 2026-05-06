// student-app/src/components/tasks/types/BrainBlitzTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
// Victory handling is centralized in TaskRunner (plays the correct victory video to completion).
import { TaskCardFrame, Pill, PrimaryButton } from "../taskStyles";
import { StepDesignatedWriter } from "../DesignatedWriter.jsx";

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
export default function BrainBlitzTask({ task, onSubmit, disabled, socket, mode = "play", review = null, memberNames = [] }) {
  const [isListening, setIsListening] = useState(false);
  const [currentClueIndex, setCurrentClueIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showVictory, setShowVictory] = useState(false); // retained for legacy; TaskRunner owns victory overlay
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Round/answer overlay (after every 3 clues)
  const ROUND_SIZE = 3;
  const [showAnswerOverlay, setShowAnswerOverlay] = useState(false);
  const [overlayRange, setOverlayRange] = useState({ start: 0, end: -1 });

  // Mic support / permission hints (avoid false 'no mic' messaging)
  const [micSupported, setMicSupported] = useState(true);
  const [micError, setMicError] = useState(null);

  // "Get ready…" staging
  const [countdown, setCountdown] = useState(null); // null | 3..0

  // Live guess feed (render exactly as received)
  const [guessFeed, setGuessFeed] = useState([]); // newest last
  const lastGuessKeysRef = useRef(new Set());

  // Confetti moment on a correct guess
  const [celebrateKey, setCelebrateKey] = useState(null);

  // Interim transcript (shows what the mic is hearing in real time)
  const [interimTranscript, setInterimTranscript] = useState("");

  // Manual type-in fallback (when mic fails due to network etc.)
  const [manualInput, setManualInput] = useState("");

  // Per-clue attempt tracking: max guesses = number of words in the answer
  // After each wrong guess, reveal one more word from the answer as a hint.
  const [clueAttempts, setClueAttempts] = useState(0); // wrong guesses for current clue

  const recognitionRef = useRef(null);
  const listeningTimeoutRef = useRef(null);
  const clueIndexRef = useRef(currentClueIndex);
  clueIndexRef.current = currentClueIndex; // always mirrors latest state
  const wantListeningRef = useRef(false); // true while mic should stay on (tap-on/tap-off)

  const clues = useMemo(() => {
    const raw =
      (Array.isArray(task?.clues) && task.clues) ||
      (Array.isArray(task?.config?.clues) && task.config.clues) ||
      [];
    // Fallback: if clues are plain strings, use the task-level correctAnswer for all
    const taskAnswer = String(task?.correctAnswer ?? task?.config?.correctAnswer ?? "").trim();
    return raw
      .map((c, idx) => {
        if (typeof c === "string") return { clue: c, answer: taskAnswer };
        if (c && typeof c === "object") {
          const clue = String(c.clue ?? c.prompt ?? c.text ?? c.question ?? `Clue ${idx + 1}`).trim();
          const answer = String(c.answer ?? c.solution ?? c.correctAnswer ?? "").trim() || taskAnswer;
          return { clue, answer };
        }
        return { clue: `Clue ${idx + 1}`, answer: taskAnswer };
      })
      .filter((c) => c && c.clue);
  }, [task]);

  const currentClue =
    currentClueIndex >= 0 && currentClueIndex < clues.length ? clues[currentClueIndex] : null;

  // Max guesses per clue = number of words in the answer (min 2).
  // After each wrong guess, reveal one more word.
  const getMaxGuesses = (answer) => {
    if (!answer) return 3;
    return Math.max(2, answer.trim().split(/\s+/).length);
  };

  // Build progressive word hint: after N wrong guesses, show the first N words.
  // For single-word answers, show first letter + blanks instead.
  const buildWordHint = (answer, attempts) => {
    if (!answer || attempts <= 0) return "";
    const words = answer.trim().split(/\s+/);
    if (words.length <= 1) {
      // Single word: show first letter + blanks + letter count
      const w = words[0] || "";
      const first = w.charAt(0).toUpperCase();
      const blanks = Array(Math.max(w.length - 1, 0)).fill("_").join(" ");
      return blanks ? `${first} ${blanks}  (${w.length} letters)` : first;
    }
    const revealed = words.slice(0, attempts).join(" ");
    const remaining = words.length - attempts;
    if (remaining <= 0) return revealed; // all words shown
    return revealed + " …";
  };

  // Advance to next clue, resetting per-clue state
  const advanceClue = () => {
    setClueAttempts(0);
    setCurrentClueIndex((prev) => prev + 1);
  };

  useEffect(() => {
    // Reset round overlay when a new task arrives
    setShowAnswerOverlay(false);
    setOverlayRange({ start: 0, end: -1 });
    setMicError(null);
    setClueAttempts(0);
  }, [task?._id, task?.id, task?.taskId]);

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
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;

    if (!SpeechRecognition) {
      setMicSupported(false);
      recognitionRef.current = null;
      return;
    }

    setMicSupported(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;       // keep listening for multiple results
    recognition.interimResults = true;   // show partial transcripts while speaking
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;     // consider alternative transcriptions

    recognition.onresult = (event) => {
      // Gather the latest final result
      let spoken = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript?.trim() || "";
        if (event.results[i].isFinal) {
          spoken = transcript;
          isFinal = true;
        } else {
          // Show interim transcript so the student sees what's being heard
          setInterimTranscript(transcript);
        }
      }
      if (!isFinal) return; // wait for final result
      setInterimTranscript("");

      // Read from ref so this handler doesn't need to be recreated per clue
      const ci = clueIndexRef.current;
      const clueObj = ci >= 0 && ci < clues.length ? clues[ci] : null;

      const correctAnswer = (clueObj?.answer || "").toLowerCase();
      const spokenLower = String(spoken).toLowerCase();

      // Also check all alternative transcriptions for a match
      let isCorrect = false;
      if (correctAnswer) {
        const alternatives = [];
        const lastResult = event.results[event.results.length - 1];
        for (let a = 0; a < (lastResult?.length || 0); a++) {
          alternatives.push((lastResult[a]?.transcript || "").trim().toLowerCase());
        }
        isCorrect = alternatives.some(
          (alt) => alt.includes(correctAnswer) || correctAnswer.includes(alt)
        ) || spokenLower.includes(correctAnswer) || correctAnswer.includes(spokenLower);
      }

      // Render the guess immediately (local)
      pushGuess({ by: "You", spoken, correct: isCorrect, clueIndex: ci });

      if (isCorrect) {
        setScore((prev) => prev + 100);
        playSound("/sounds/correct.mp3");
        triggerCelebrate();
      } else {
        // Participation points for trying (first wrong guess per clue only)
        const alreadyGuessedThisClue = guesses.some((g) => g.clueIndex === ci);
        if (!alreadyGuessedThisClue) {
          setScore((prev) => prev + 25);
        }
        playSound("/sounds/wrong.mp3");
      }

      if (socket) {
        socket.emit("brain-blitz-answer", {
          roomCode: task?.roomCode,
          clueIndex: ci,
          spoken,
          correct: isCorrect,
        });
      }

      if (isCorrect) {
        // Correct answer — stop mic, advance clue.
        wantListeningRef.current = false;
        try { recognition.stop(); } catch {}
        if (listeningTimeoutRef.current) { clearTimeout(listeningTimeoutRef.current); listeningTimeoutRef.current = null; }
        setCountdown(null);
        setIsListening(false);
        advanceClue();
      } else {
        // Wrong answer — track attempts, progressive word hints, auto-advance when exhausted
        const maxGuesses = getMaxGuesses(clueObj?.answer);
        setClueAttempts((prev) => {
          const next = prev + 1;
          if (next >= maxGuesses) {
            // Out of guesses — stop mic, reveal answer briefly, then advance
            wantListeningRef.current = false;
            try { recognition.stop(); } catch {}
            if (listeningTimeoutRef.current) { clearTimeout(listeningTimeoutRef.current); listeningTimeoutRef.current = null; }
            setCountdown(null);
            setIsListening(false);
            setTimeout(() => advanceClue(), 1800);
          }
          return next;
        });
      }
    };

    recognition.onerror = (event) => {
      const err = event?.error || "mic-error";
      // "no-speech" and "aborted" are harmless — onend will handle restart
      if (err === "no-speech" || err === "aborted") return;
      try { setMicError(err); } catch {}
      wantListeningRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      // If we still WANT to be listening (tap-on), auto-restart after a tiny gap.
      // This handles all browser quirks: unexpected onend, no-speech cycling, etc.
      if (wantListeningRef.current) {
        setTimeout(() => {
          try {
            recognition.start();
            // don't touch setIsListening — it's already true, avoid flicker
          } catch {
            wantListeningRef.current = false;
            setIsListening(false);
          }
        }, 120);
        return;
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clues, socket, task?.roomCode, disabled]);

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

  // Clean up mic when no active clue or overlay is showing.
  useEffect(() => {
    if (!currentClue || disabled || showAnswerOverlay) {
      wantListeningRef.current = false;
      if (listeningTimeoutRef.current) { clearTimeout(listeningTimeoutRef.current); listeningTimeoutRef.current = null; }
      try { recognitionRef.current?.stop?.(); } catch {}
      setIsListening(false);
      setInterimTranscript("");
    }

    return () => {
      wantListeningRef.current = false;
      if (listeningTimeoutRef.current) { clearTimeout(listeningTimeoutRef.current); listeningTimeoutRef.current = null; }
      try { recognitionRef.current?.stop?.(); } catch {}
      setIsListening(false);
    };
  }, [currentClue, disabled, showAnswerOverlay]);

  
  // After each round of 3 clues, pause and show an answer overlay (round recap).
  useEffect(() => {
    if (!clues.length) return;
    if (disabled) return;

    // Only in play mode (not review) and only if there are more clues to go.
    if (mode === "review") return;

    const i = currentClueIndex;

    // When we *just completed* a round boundary (3, 6, 9...) and there are remaining clues, show overlay.
    if (i > 0 && i % ROUND_SIZE === 0 && i < clues.length) {
      // Prevent re-opening if already open for this boundary.
      setShowAnswerOverlay(true);
      setOverlayRange({ start: Math.max(0, i - ROUND_SIZE), end: i - 1 });

      // Stop any pending listening so we don't get stray mic banners.
      try { recognitionRef.current?.stop?.(); } catch {}
      setIsListening(false);
      setCountdown(null);
    }
  }, [currentClueIndex, clues.length, disabled, mode]);
// End-of-round
  useEffect(() => {
    if (!clues.length) return;
    if (currentClueIndex >= clues.length && !hasSubmitted) {
      setHasSubmitted(true);
      onSubmit?.({ finalScore: score });
      setShowVictory(true); // local victory UI is disabled; TaskRunner handles the win sequence
    }
  }, [clues.length, currentClueIndex, hasSubmitted, onSubmit, score]);

  const handleMicToggle = () => {
    if (!recognitionRef.current || disabled) return;
    if (isListening) {
      // Tap OFF
      wantListeningRef.current = false;
      if (listeningTimeoutRef.current) { clearTimeout(listeningTimeoutRef.current); listeningTimeoutRef.current = null; }
      try { recognitionRef.current.stop(); } catch {}
      setIsListening(false);
      setInterimTranscript("");
    } else {
      // Tap ON
      wantListeningRef.current = true;
      try { setMicError(null); } catch {}
      try {
        recognitionRef.current.start();
        setIsListening(true);
        setCountdown(null);
      } catch {}
    }
  };
  // Keep old name as alias for any other references
  const handleManualStart = handleMicToggle;

  const handleManualSubmit = () => {
    const spoken = manualInput.trim();
    const maxGuesses = getMaxGuesses(currentClue?.answer);
    if (!spoken || clueAttempts >= maxGuesses) return;
    setManualInput("");

    const ci = clueIndexRef.current;
    const clueObj = ci >= 0 && ci < clues.length ? clues[ci] : null;
    const correctAnswer = (clueObj?.answer || "").toLowerCase();
    const spokenLower = spoken.toLowerCase();
    const isCorrect = correctAnswer && (spokenLower.includes(correctAnswer) || correctAnswer.includes(spokenLower));

    pushGuess({ by: "You", spoken, correct: isCorrect, clueIndex: ci });

    if (isCorrect) {
      setScore((prev) => prev + 100);
      playSound("/sounds/correct.mp3");
      triggerCelebrate();
    } else {
      // Participation points for trying (first wrong guess per clue only)
      const alreadyGuessedThisClue = guesses.some((g) => g.clueIndex === ci);
      if (!alreadyGuessedThisClue) {
        setScore((prev) => prev + 25);
      }
      playSound("/sounds/wrong.mp3");
    }

    if (socket) {
      socket.emit("brain-blitz-answer", {
        roomCode: task?.roomCode,
        clueIndex: ci,
        spoken,
        correct: isCorrect,
      });
    }

    if (isCorrect) {
      advanceClue();
    } else {
      setClueAttempts((prev) => {
        const next = prev + 1;
        if (next >= maxGuesses) {
          setTimeout(() => advanceClue(), 1800);
        }
        return next;
      });
    }
  };

  // Always show type-in — works as primary input or fallback alongside mic
  const showTypeFallback = true;

  const statusLabel = showAnswerOverlay
    ? "Round recap"
    : isListening
    ? "Listening…"
    : countdown != null && countdown > 0
    ? `Get ready… ${countdown}`
    : "Get ready…";

  const right = (
    <>
      <Pill>🧩 Clue {Math.min(clues.length, currentClueIndex + 1)} / {clues.length || 0}</Pill>
      <Pill>🏆 Score {score}</Pill>
    </>
  );


  const isReviewMode = mode === "review";

  // Build a best-effort per-clue guess history from review payloads (teacher reports / replay).
  const reviewGuessesRaw =
    (Array.isArray(review?.guesses) && review.guesses) ||
    (Array.isArray(review?.guessFeed) && review.guessFeed) ||
    (Array.isArray(review?.events) && review.events) ||
    (Array.isArray(review?.answers) && review.answers) ||
    [];

  const guessesByClue = useMemo(() => {
    const map = new Map();
    for (const g of reviewGuessesRaw) {
      if (!g) continue;
      const clueIndex =
        Number.isFinite(Number(g.clueIndex)) ? Number(g.clueIndex)
        : Number.isFinite(Number(g.index)) ? Number(g.index)
        : Number.isFinite(Number(g.questionIndex)) ? Number(g.questionIndex)
        : null;

      const by = g.by || g.teamName || g.team || g.player || g.name || "Team";
      const spoken = g.spoken || g.answer || g.text || g.guess || "";
      const correct = !!g.correct;

      if (clueIndex == null) continue;
      const arr = map.get(clueIndex) || [];
      arr.push({ by: String(by).slice(0, 32), spoken: String(spoken).trim().slice(0, 160), correct });
      map.set(clueIndex, arr);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(reviewGuessesRaw || [])]);
  // ---------------- UI ----------------


  // Review mode: show all clues + correct answers + guess history (no mic / no gameplay UI).
  if (isReviewMode) {
    return (
      <TaskCardFrame
       
        badge="📝 Review Answers"
        title="BRAIN BLITZ REVIEW"
        subtitle="Questions, guesses, and correct answers"
        right={<Pill>⚡ {clues.length} clues</Pill>}
        style={{
          background:
            "radial-gradient(900px 380px at 20% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(900px 380px at 80% 0%, rgba(236,72,153,0.14), transparent 60%), linear-gradient(135deg, rgba(238,242,255,1), rgba(255,255,255,1))",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          {clues.map((c, idx) => {
            const guesses = guessesByClue.get(idx) || [];
            const hasAnswer = String(c?.answer || "").trim().length > 0;

            return (
              <div
                key={idx}
                style={{
                  padding: 14,
                  borderRadius: 18,
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(15,23,42,0.12)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <Pill>Clue {idx + 1}</Pill>
                  {hasAnswer ? (
                    <Pill>✅ What is {String(c.answer).toLowerCase()}?</Pill>
                  ) : (
                    <Pill>⚠ No answer provided</Pill>
                  )}
                </div>

                <div style={{ marginTop: 10, fontSize: 18, fontWeight: 950, lineHeight: 1.25 }}>
                  {c.clue}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 950, marginBottom: 6, opacity: 0.85 }}>Guesses</div>

                  {guesses.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No guesses recorded.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {guesses.slice().reverse().map((g, gi) => (
                        <div
                          key={`${idx}:${gi}`}
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
                          <div style={{ minWidth: 34, fontWeight: 950 }}>{g.correct ? "✅" : "💬"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 850, fontSize: 13, opacity: 0.85 }}>{g.by}</div>
                            <div style={{ fontWeight: 900, fontSize: 14 }}>
                              {g.spoken || "(inaudible)"}
                            </div>
                          </div>
                          {g.correct && <Pill>Correct</Pill>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TaskCardFrame>
    );
  }

  if (!clues.length) {
    return (
      <TaskCardFrame badge="⚡ Brain Blitz" title="No clues provided" subtitle="This round didn't include any clues.">
        <div style={{ color: "rgba(15,23,42,0.74)", fontWeight: 850 }}>
          Check the task JSON and ensure it includes <b>clues</b>.
        </div>
      </TaskCardFrame>
    );
  }

  if (!currentClue && currentClueIndex >= clues.length) {
    return (
      <TaskCardFrame
       
        badge="🏁 Round Complete"
        title="Brain Blitz Complete!"
        subtitle="Final Score"
        right={<Pill>🏆 {score}</Pill>}
      >
        {/* Local victory overlay removed — TaskRunner handles victory so it isn't cut short. */}
      </TaskCardFrame>
    );
  }

  return (
    <TaskCardFrame
     
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
        @keyframes bbMicPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 12px rgba(239,68,68,0); }
        }
        @keyframes bbMicWave {
          0% { height: 4px; }
          50% { height: 18px; }
          100% { height: 4px; }
        }
      `}</style>


      {/* Round answer overlay (after each set of 3) */}
      {showAnswerOverlay && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            background: "rgba(2,6,23,0.55)",
            backdropFilter: "blur(6px)",
            borderRadius: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(760px, 96vw)",
              maxHeight: "80vh",
              overflow: "auto",
              borderRadius: 22,
              background: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(15,23,42,0.18)",
              boxShadow: "0 18px 50px rgba(2,6,23,0.35)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 950, fontSize: 18 }}>
                ✅ Round {(overlayRange.start / ROUND_SIZE) + 1} Answers
              </div>
              <Pill>Clues {overlayRange.start + 1}–{overlayRange.end + 1}</Pill>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {clues.slice(overlayRange.start, overlayRange.end + 1).map((c, i) => {
                const idx = overlayRange.start + i;
                const ans = String(c?.answer || "").trim();
                return (
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      borderRadius: 16,
                      background: "#ffffff",
                      border: "1px solid rgba(15,23,42,0.10)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <Pill>Clue {idx + 1}</Pill>
                      <Pill>{ans ? `What is ${ans.toLowerCase()}?` : "Answer: (not provided)"}</Pill>
                    </div>
                    <div style={{ marginTop: 8, fontWeight: 900, fontSize: 16, lineHeight: 1.25 }}>
                      {c?.clue}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
              border: "1px solid rgba(34,197,94,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 15,
              fontWeight: 800,
            }}>
              <span>🏆 Your Score</span>
              <span style={{ fontSize: 20 }}>{score} pts</span>
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <PrimaryButton
                onClick={() => {
                  setShowAnswerOverlay(false);
                  setCountdown(null);
                  setIsListening(false);
                }}
              >
                Continue ➜
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}


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

      {/* Never let students think guesses are shared when the room isn't connected. */}
      {!socket && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 16,
            background: "rgba(245,158,11,0.12)",
            border: "1px solid rgba(245,158,11,0.30)",
            color: "#7c2d12",
            fontWeight: 900,
            marginBottom: 12,
          }}
        >
          Offline mode — guesses are only visible on this device.
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {/* How-to-play example — show on the first clue only */}
        {currentClueIndex === 0 && (
          <div style={{
            padding: 14,
            borderRadius: 16,
            background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(236,72,153,0.06))",
            border: "1px solid rgba(99,102,241,0.18)",
          }}>
            <div style={{ fontWeight: 950, fontSize: 14, color: "#4338ca", marginBottom: 8 }}>
              How to play Brain Blitz
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "#334155" }}>
              Read each clue, then <b>shout your answer as a question</b> (Jeopardy style).
            </div>
            <div style={{
              marginTop: 10,
              padding: "10px 14px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.8)",
              border: "1px solid rgba(15,23,42,0.08)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Example</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>
                Clue: "This process converts sunlight into food for plants"
              </div>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#059669", marginTop: 4 }}>
                You shout: "What is photosynthesis?"
              </div>
            </div>
          </div>
        )}

        {/* Per-clue rotation: different team member reads/answers each clue */}
        {memberNames.length >= 2 && (
          <StepDesignatedWriter
            memberNames={memberNames}
            taskIndex={task?._taskIndex}
            stepIndex={currentClueIndex}
            role="reader"
          />
        )}
        <div
          style={{
            padding: 16,
            borderRadius: 18,
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(15,23,42,0.12)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.7, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Clue {currentClueIndex + 1} / {clues.length}</span>
            {(() => {
              const max = getMaxGuesses(currentClue?.answer);
              const left = max - clueAttempts;
              return clueAttempts > 0 && left > 0 ? (
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                  {left} {left === 1 ? "guess" : "guesses"} left
                </span>
              ) : null;
            })()}
          </div>
          <div style={{ fontSize: 22, fontWeight: 950, lineHeight: 1.2 }}>
            {currentClue?.clue}
          </div>

          {/* Progressive word hint: after each wrong guess, reveal one more word */}
          {clueAttempts > 0 && currentClue?.answer && clueAttempts < getMaxGuesses(currentClue.answer) && (
            <div style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 12,
              background: "rgba(234,179,8,0.12)",
              border: "1px solid rgba(234,179,8,0.3)",
              fontSize: 16,
              fontWeight: 800,
              color: "#92400e",
            }}>
              💡 {buildWordHint(currentClue.answer, clueAttempts)}
            </div>
          )}

          {/* Answer reveal (after max guesses exhausted) */}
          {currentClue?.answer && clueAttempts >= getMaxGuesses(currentClue.answer) && (
            <div style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 12,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.25)",
              fontSize: 15,
              fontWeight: 900,
              color: "#dc2626",
            }}>
              Answer: What is {currentClue.answer.toLowerCase()}?
            </div>
          )}

          {/* Skip clue button — available until max guesses exhausted */}
          {clueAttempts < getMaxGuesses(currentClue?.answer) && (
            <button
              type="button"
              onClick={() => {
                pushGuess({ by: "You", spoken: "(skipped)", correct: false, clueIndex: currentClueIndex });
                advanceClue();
              }}
              style={{
                marginTop: 10,
                padding: "6px 14px",
                border: "none",
                borderRadius: 10,
                background: "transparent",
                color: "#64748b",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                opacity: 0.8,
              }}
            >
              Skip this clue →
            </button>
          )}
        </div>

        {/* Mic toggle — tap on / tap off */}
        {isListening ? (
          <div
            onClick={handleMicToggle}
            role="button"
            tabIndex={0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 18px",
              borderRadius: 18,
              background: "rgba(239,68,68,0.08)",
              border: "2px solid rgba(239,68,68,0.35)",
              animation: "bbMicPulse 1.5s ease-in-out infinite",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #ef4444, #dc2626)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              🎤
            </div>
            {/* Audio waveform bars */}
            <div style={{ display: "flex", gap: 3, alignItems: "center", height: 24 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 4,
                    borderRadius: 2,
                    background: "#ef4444",
                    animation: `bbMicWave ${600 + i * 120}ms ease-in-out ${i * 80}ms infinite`,
                  }}
                />
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 950, fontSize: 15, color: "#dc2626" }}>
                LISTENING — Shout your answer!
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", marginTop: 1 }}>
                Tap to stop mic
              </div>
              {interimTranscript && (
                <div style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginTop: 2, fontStyle: "italic" }}>
                  Hearing: "{interimTranscript}"
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            onClick={handleMicToggle}
            role="button"
            tabIndex={0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 18px",
              borderRadius: 18,
              background: "rgba(15,23,42,0.04)",
              border: "2px solid rgba(15,23,42,0.15)",
              cursor: recognitionRef.current && !disabled ? "pointer" : "default",
              opacity: !micSupported ? 0.5 : 1,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #6b7280, #4b5563)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              🎤
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 950, fontSize: 15, color: "#1e293b" }}>
                Tap to start mic
              </div>
              {!micSupported && (
                <div style={{ fontSize: 12, color: "#ef4444", marginTop: 2 }}>Mic not supported in this browser</div>
              )}
              {micSupported && micError && (
                <div style={{ fontSize: 12, color: "#ef4444", marginTop: 2, lineHeight: 1.4 }}>
                  {micError === "not-allowed" || micError === "service-not-allowed"
                    ? <>Mic blocked — tap the 🔒 in your address bar → Site settings → Microphone → Allow, then reload</>
                    : micError === "network"
                    ? "Voice recognition unavailable — type your answer below"
                    : `Mic error: ${String(micError)} — tap to retry`}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual type-in fallback when mic is unavailable */}
        {showTypeFallback && currentClue && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleManualSubmit(); }}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Type your answer and hit Enter"
              autoFocus
              style={{
                flex: 1,
                padding: "12px 14px",
                fontSize: 16,
                fontWeight: 700,
                borderRadius: 14,
                border: "2px solid rgba(99,102,241,0.3)",
                outline: "none",
                background: "#fff",
                color: "#0f172a",
              }}
            />
            <button
              type="submit"
              disabled={!manualInput.trim()}
              style={{
                padding: "12px 20px",
                fontSize: 15,
                fontWeight: 900,
                borderRadius: 14,
                border: "none",
                background: manualInput.trim() ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#e2e8f0",
                color: manualInput.trim() ? "#fff" : "#94a3b8",
                cursor: manualInput.trim() ? "pointer" : "default",
              }}
            >
              Shout!
            </button>
          </form>
        )}

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
                      <div style={{ fontWeight: 850, fontSize: 13, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.by} {Number.isFinite(g.clueIndex) && clues[g.clueIndex]?.clue ? `• ${clues[g.clueIndex].clue}` : ""}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.spoken || "(inaudible)"}
                      </div>
                    </div>
                    {g.correct && <Pill>+100</Pill>}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </TaskCardFrame>
  );
}
