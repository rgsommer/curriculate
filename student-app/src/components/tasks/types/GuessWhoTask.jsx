// student-app/src/components/tasks/types/GuessWhoTask.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSound from "use-sound";

const DEFAULT_MAX_GUESSES = 10;
const DEFAULT_TIMER_SECONDS = 60;

// Local "Curriculate-ish" neutrals (kept self-contained)
const CONTRAST_TEXT_DARK = "#0f172a";
const CONTRAST_BG_LIGHT = "#f9fafb";
const CONTRAST_BORDER = "#d1d5db";
const ACCENT = "#6366f1";
const GOOD = "#16a34a";
const BAD = "#dc2626";

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeStr(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

export default function GuessWhoTask({ task, onSubmit }) {
  // Config (robust defaults)
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const playerCount = clampInt(cfg.playerCount ?? task?.playerCount, 1, 12, 1);
  const maxGuesses = clampInt(cfg.maxGuesses, 1, 50, DEFAULT_MAX_GUESSES);
  const timerSeconds = clampInt(task?.timeLimitSeconds ?? cfg.timerSeconds, 10, 600, DEFAULT_TIMER_SECONDS);

  // Secret answers can be per-round (rotating answerer) or a single secret.
  const secretAnswers = useMemo(() => {
    const raw =
      Array.isArray(cfg.secretAnswers) && cfg.secretAnswers.length
        ? cfg.secretAnswers
        : normalizeStr(cfg.secretAnswer)
        ? [String(cfg.secretAnswer).trim()]
        : ["Mystery"];

    // Ensure we have at least playerCount entries if you want "one per answerer/round"
    // (If you only provide one, it just repeats.)
    const out = [];
    for (let i = 0; i < Math.max(1, playerCount); i++) out.push(raw[i] ?? raw[0]);
    return out;
  }, [cfg.secretAnswers, cfg.secretAnswer, playerCount]);

  // Optional category/theme label
  const categoryLabel = (cfg.category && String(cfg.category).trim()) || "";
  const revealHint = (cfg.revealHint && String(cfg.revealHint).trim()) || "Hold to reveal";

  // Player identity (intra-team only)
  const myPlayerNumber = clampInt(task?.myPlayerNumber ?? cfg.myPlayerNumber, 1, 99, 1);

  // Rounds (default: rotate answerer through playerCount; "round" is per answerer)
  const [currentRound, setCurrentRound] = useState(0);

  const currentAnswerer = useMemo(() => (currentRound % playerCount) + 1, [currentRound, playerCount]);
  const isAnswerer = currentAnswerer === myPlayerNumber;
  const canAskOrGuess = !isAnswerer;

  const secretAnswer = useMemo(() => {
    const v = secretAnswers[currentRound] ?? secretAnswers[0] ?? "Mystery";
    return String(v || "Mystery").trim();
  }, [secretAnswers, currentRound]);

  // Q/A + guesses
  const [questions, setQuestions] = useState([]); // { text, player, answer: "Yes"|"No"|null }
  const [questionInput, setQuestionInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [guessCount, setGuessCount] = useState(0);

  // Timing + overlays
  const [showSecret, setShowSecret] = useState(false);
  const [timerStarted, setTimerStarted] = useState(false);
  const [timer, setTimer] = useState(timerSeconds);

  const [roundOver, setRoundOver] = useState(false);
  const [winnerThisRound, setWinnerThisRound] = useState(false);

  const [submissionFeedback, setSubmissionFeedback] = useState(null); // { message, positive }
  const [overlayTimer, setOverlayTimer] = useState(null); // null = manual advance

  const countdownRef = useRef(null);
  const overlayIntervalRef = useRef(null);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
  }, []);

  const clearOverlayInterval = useCallback(() => {
    if (overlayIntervalRef.current) clearInterval(overlayIntervalRef.current);
    overlayIntervalRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearCountdown();
      clearOverlayInterval();
    };
  }, [clearCountdown, clearOverlayInterval]);

  const endRoundWithOverlay = useCallback(
    ({ message, positive, correct }) => {
      setSubmissionFeedback({ message, positive: !!positive });
      setRoundOver(true);
      setWinnerThisRound(!!correct);

      // stop timers
      clearCountdown();
      clearOverlayInterval();

      // Optional overlay countdown (kept, but now well-formed)
      setOverlayTimer(15);
      overlayIntervalRef.current = setInterval(() => {
        setOverlayTimer((prev) => {
          if (prev == null) return prev;
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
    },
    [clearCountdown, clearOverlayInterval]
  );

  const resetRoundState = useCallback(
    (nextRoundIndex) => {
      // stop any running timers
      clearCountdown();
      clearOverlayInterval();

      setShowSecret(false);
      setTimerStarted(false);
      setTimer(timerSeconds);

      setQuestions([]);
      setQuestionInput("");
      setGuessInput("");
      setGuessCount(0);

      setRoundOver(false);
      setWinnerThisRound(false);
      setOverlayTimer(null);
      setSubmissionFeedback(null);

      setCurrentRound(nextRoundIndex);
    },
    [clearCountdown, clearOverlayInterval, timerSeconds]
  );


  // Manual advance (no forced review timer for GuessWho)
  const handleContinue = useCallback(() => {
    if (!submissionFeedback) return;

    // Clear overlay
    setSubmissionFeedback(null);

    // Advance rounds (answerer rotates)
    setCurrentRound((prev) => {
      const next = prev + 1;

      if (next < playerCount) {
        queueMicrotask(() => resetRoundState(next));
        return prev; // resetRoundState will set it
      }

      // Done: submit completion payload
      queueMicrotask(() => {
        onSubmit?.({
          type: task?.taskType || "guess-who",
          gameComplete: true,
          roundsPlayed: playerCount,
        });
      });
      return prev;
    });
  }, [submissionFeedback, playerCount, onSubmit, resetRoundState, task?.taskType]);

  // Audio stubs (replace with real useSound hooks when ready)
  const playYes = useCallback(() => {}, []);
  const playNo = useCallback(() => {}, []);
  const playCorrect = useCallback(() => {}, []);
  const playWrong = useCallback(() => {}, []);
  const playBeep = useCallback(() => {}, []);
  const playBuzzer = useCallback(() => {}, []);

  const startCountdownIfNeeded = useCallback(() => {
    if (timerStarted) return;
    setTimerStarted(true);

    countdownRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearCountdown();
          playBuzzer();
          endRoundWithOverlay({
            message: `Time's up! The answer was: ${secretAnswer}`,
            positive: false,
            correct: false,
          });
          return 0;
        }
        if (prev <= 11) playBeep();
        return prev - 1;
      });
    }, 1000);
  }, [timerStarted, clearCountdown, endRoundWithOverlay, playBuzzer, playBeep, secretAnswer]);

  const handleRevealPress = useCallback(() => {
    if (!isAnswerer || roundOver) return;
    setShowSecret(true);
    startCountdownIfNeeded();
  }, [isAnswerer, roundOver, startCountdownIfNeeded]);

  const handleRevealRelease = useCallback(() => {
    setShowSecret(false);
  }, []);

  const handleAskQuestion = useCallback(() => {
    if (!canAskOrGuess || roundOver) return;
    const q = String(questionInput || "").trim();
    if (!q) return;

    setQuestions((prev) => [...prev, { text: q, player: myPlayerNumber, answer: null }]);
    setQuestionInput("");
  }, [canAskOrGuess, roundOver, questionInput, myPlayerNumber]);

  const handleYouGuessedIt = useCallback(() => {
    if (!isAnswerer || roundOver) return;

    playCorrect?.();
    endRoundWithOverlay({
      message: `🎉 You guessed it! The answer was: ${secretAnswer}`,
      positive: true,
      correct: true,
    });

    onSubmit?.({
      type: task?.taskType || "guess-who",
      roundComplete: true,
      correct: true,
      secretAnswer,
      guessesUsed: guessCount,
      maxGuesses,
      timeRemaining: Math.max(0, timer),
      pointsEarned: 0,
      roundIndex: currentRound,
      confirmedByAnswerer: true,
    });
  }, [
    isAnswerer,
    roundOver,
    endRoundWithOverlay,
    onSubmit,
    task?.taskType,
    secretAnswer,
    guessCount,
    maxGuesses,
    timer,
    currentRound,
  ]);

  const handleAnswerYesNo = useCallback(
    (answer) => {
      if (!isAnswerer || roundOver) return;

      setQuestions((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (!last || last.answer) return prev;

        const updated = [...prev];
        updated[updated.length - 1] = { ...last, answer };

        if (answer === "Yes") playYes?.();
        else playNo?.();

        return updated;
      });
    },
    [isAnswerer, roundOver, playYes, playNo]
  );

  const handleMakeGuess = useCallback(() => {
    if (!canAskOrGuess || roundOver) return;
    const guess = String(guessInput || "").trim();
    if (!guess) return;
    if (guessCount >= maxGuesses) return;

    const correct = normalizeStr(guess) === normalizeStr(secretAnswer);
    const nextGuessCount = guessCount + 1;
    setGuessCount(nextGuessCount);
    setGuessInput("");

    if (correct) {
      playCorrect();

      // Optional points model: reward speed + fewer guesses (purely informational unless backend uses it)
      const timeRemaining = Math.max(0, timer);
      const base = 10;
      const timeBonus = Math.floor(timeRemaining / 10); // 0..6 if 60s
      const guessBonus = Math.max(0, Math.floor((maxGuesses - nextGuessCount) / 2)); // modest
      const pointsEarned = base + timeBonus + guessBonus;

      endRoundWithOverlay({
        message: `✅ Correct! You got it in ${nextGuessCount}/${maxGuesses} guesses.`,
        positive: true,
        correct: true,
      });

      // Fire a useful "round result" payload immediately (optional; safe)
      onSubmit?.({
        type: task?.taskType || "guess-who",
        roundComplete: true,
        correct: true,
        secretAnswer,
        guessesUsed: nextGuessCount,
        maxGuesses,
        timeRemaining,
        pointsEarned,
        roundIndex: currentRound,
      });

      return;
    }

    playWrong();

    if (nextGuessCount >= maxGuesses) {
      endRoundWithOverlay({
        message: `❌ Out of guesses! The answer was: ${secretAnswer}`,
        positive: false,
        correct: false,
      });

      onSubmit?.({
        type: task?.taskType || "guess-who",
        roundComplete: true,
        correct: false,
        secretAnswer,
        guessesUsed: nextGuessCount,
        maxGuesses,
        timeRemaining: Math.max(0, timer),
        pointsEarned: 0,
        roundIndex: currentRound,
      });
    }
  }, [
    canAskOrGuess,
    roundOver,
    guessInput,
    guessCount,
    maxGuesses,
    secretAnswer,
    timer,
    currentRound,
    endRoundWithOverlay,
    onSubmit,
    playCorrect,
    playWrong,
    task?.taskType,
  ]);

  // UI helpers
  const topBadge = useMemo(() => {
    const parts = [];
    parts.push(`Round ${currentRound + 1}/${playerCount}`);
    parts.push(`Answerer: Player ${currentAnswerer}`);
    if (categoryLabel) parts.push(`Category: ${categoryLabel}`);
    return parts.join(" • ");
  }, [currentRound, playerCount, currentAnswerer, categoryLabel]);

  const guessesLeft = Math.max(0, maxGuesses - guessCount);

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${CONTRAST_BORDER}`,
          background: "#ffffff",
          boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
          padding: 16,
          maxWidth: 980,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <div
            style={{
              fontFamily:
                '"Interstellar Log", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: "1.55rem",
              letterSpacing: "1px",
              color: CONTRAST_TEXT_DARK,
              marginBottom: 8,
            }}
          >
            Guess Who?
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: CONTRAST_BG_LIGHT,
              color: CONTRAST_TEXT_DARK,
              fontWeight: 600,
              fontSize: "0.95rem",
            }}
          >
            {topBadge}
          </div>
        </div>

        {/* Timer */}
        {timerStarted && (
          <div style={{ textAlign: "center", margin: "12px 0 6px" }}>
            <div
              style={{
                display: "inline-block",
                padding: "8px 14px",
                borderRadius: 999,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: timer <= 10 ? "#fee2e2" : CONTRAST_BG_LIGHT,
                color: timer <= 10 ? BAD : CONTRAST_TEXT_DARK,
                fontWeight: 900,
                fontSize: "1.6rem",
                minWidth: 110,
              }}
            >
              {timer}s
            </div>
          </div>
        )}

        {/* Answerer reveal */}
        {isAnswerer && !roundOver && (
          <div style={{ textAlign: "center", margin: "12px 0 16px" }}>
            <button
              onMouseDown={handleRevealPress}
              onMouseUp={handleRevealRelease}
              onMouseLeave={handleRevealRelease}
              onTouchStart={handleRevealPress}
              onTouchEnd={handleRevealRelease}
              style={{
                padding: "16px 22px",
                fontSize: "1.05rem",
                fontWeight: 800,
                background: showSecret ? GOOD : ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
                boxShadow: "0 8px 18px rgba(99,102,241,0.25)",
                maxWidth: "100%",
              }}
            >
              {showSecret ? `SECRET: ${secretAnswer}` : `${revealHint} (starts timer)`}
            </button>

            <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#475569" }}>
              Tip: Keep your finger down so teammates can't peek.
            </div>


<div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
  <button
    onClick={handleYouGuessedIt}
    style={{
      padding: "12px 16px",
      fontSize: "1.0rem",
      fontWeight: 900,
      background: GOOD,
      color: "#fff",
      border: "none",
      borderRadius: 999,
      cursor: "pointer",
      boxShadow: "0 10px 22px rgba(22,163,74,0.22)",
    }}
  >
    You Guessed It! 🎉
  </button>
</div>
          </div>
        )}

        {/* Guess/Question controls */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 12,
            marginTop: 6,
          }}
        >
          {/* Question list */}
          <div
            style={{
              borderRadius: 14,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: CONTRAST_BG_LIGHT,
              padding: 12,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 800, color: CONTRAST_TEXT_DARK, marginBottom: 8 }}>
              Yes/No Questions
            </div>

            {questions.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: "0.95rem" }}>
                Ask smart yes/no questions to eliminate possibilities.
              </div>
            ) : (
              questions.map((q, i) => (
                <div
                  key={i}
                  style={{
                    margin: "10px 0",
                    padding: 10,
                    borderRadius: 12,
                    background: "#ffffff",
                    border: `1px solid ${CONTRAST_BORDER}`,
                  }}
                >
                  <div style={{ color: CONTRAST_TEXT_DARK, fontWeight: 700 }}>
                    Player {q.player}:{" "}
                    <span style={{ fontWeight: 600 }}>{q.text}</span>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    {q.answer ? (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: q.answer === "Yes" ? "#dcfce7" : "#fee2e2",
                          color: q.answer === "Yes" ? GOOD : BAD,
                          fontWeight: 900,
                          border: `1px solid ${CONTRAST_BORDER}`,
                        }}
                      >
                        {q.answer}
                      </span>
                    ) : isAnswerer && !roundOver ? (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          onClick={() => handleAnswerYesNo("Yes")}
                          style={{
                            padding: "10px 16px",
                            borderRadius: 999,
                            border: "none",
                            background: GOOD,
                            color: "#fff",
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => handleAnswerYesNo("No")}
                          style={{
                            padding: "10px 16px",
                            borderRadius: 999,
                            border: "none",
                            background: BAD,
                            color: "#fff",
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: "#64748b" }}>Waiting for answerer…</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Ask question */}
          {canAskOrGuess && !roundOver && (
            <div
              style={{
                borderRadius: 14,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: "#ffffff",
                padding: 12,
              }}
            >
              <div style={{ fontWeight: 800, color: CONTRAST_TEXT_DARK, marginBottom: 8 }}>
                Ask a yes/no question
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  placeholder="Example: Is it a person? Is it in Canada?"
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAskQuestion()}
                  style={{
                    flex: "1 1 320px",
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${CONTRAST_BORDER}`,
                    fontSize: "1rem",
                  }}
                />
                <button
                  onClick={handleAskQuestion}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 999,
                    border: "none",
                    background: ACCENT,
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Ask
                </button>
              </div>
            </div>
          )}

          {/* Guess */}
          {canAskOrGuess && !roundOver && (
            <div
              style={{
                borderRadius: 14,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: "#ffffff",
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 800, color: CONTRAST_TEXT_DARK }}>
                  Make a guess
                </div>
                <div style={{ color: "#475569", fontWeight: 700 }}>
                  Guesses: {guessCount}/{maxGuesses} • Left: {guessesLeft}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  placeholder="Type your guess…"
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleMakeGuess()}
                  style={{
                    flex: "1 1 260px",
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${CONTRAST_BORDER}`,
                    fontSize: "1rem",
                  }}
                />
                <button
                  onClick={handleMakeGuess}
                  disabled={guessCount >= maxGuesses}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 999,
                    border: "none",
                    background: guessCount >= maxGuesses ? "#9ca3af" : GOOD,
                    color: "#fff",
                    fontWeight: 900,
                    cursor: guessCount >= maxGuesses ? "not-allowed" : "pointer",
                  }}
                >
                  Guess!
                </button>
              </div>
            </div>
          )}

          {/* End state */}
          {roundOver && (
            <div style={{ textAlign: "center", marginTop: 6 }}>
              <div style={{ fontSize: "1.6rem", fontWeight: 900, color: CONTRAST_TEXT_DARK }}>
                {winnerThisRound ? "🎉 Correct!" : "⏳ Round Over"}
              </div>
              <div style={{ marginTop: 8, color: "#475569", fontWeight: 700 }}>
                {winnerThisRound ? "Nice deduction." : `Answer was: ${secretAnswer}`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Overlay */}
      {submissionFeedback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            textAlign: "center",
            padding: 20,
          }}
        >
          <div style={{ fontSize: "2.2rem", fontWeight: 900, marginBottom: 18 }}>
            {submissionFeedback.message}
          </div>
          <div style={{ fontSize: "1.05rem", color: "#e2e8f0", marginTop: 8 }}>
            Ready to continue?
          </div>

          <button
            onClick={handleContinue}
            style={{
              marginTop: 18,
              padding: "14px 18px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.10)",
              color: "#fff",
              fontWeight: 900,
              fontSize: "1.05rem",
              cursor: "pointer",
            }}
          >
            Next Round ▶
          </button>
        </div>
      )}
    </div>
  );
}
