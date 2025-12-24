// student-app/src/components/tasks/types/GuessWhoTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import useSound from "use-sound";

const DEFAULT_MAX_GUESSES = 10;
const DEFAULT_TIMER_SECONDS = 60;

// High-contrast neutrals consistent with TaskRunner inner task styling
const CONTRAST_TEXT_DARK = "#0f172a";
const CONTRAST_BG_LIGHT = "#f9fafb";
const CONTRAST_BORDER = "#d1d5db";
const CONTRAST_ACCENT = "#0ea5e9";

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeList(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

export default function GuessWhoTask({
  task,
  onSubmit,
  disabled = false,

  // kept for signature compatibility across tasks (even if unused here)
  socket,
  roomCode,
  teamId,
}) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const maxGuesses = clampInt(cfg.maxGuesses ?? task?.maxGuesses, 1, 50, DEFAULT_MAX_GUESSES);
  const timerSeconds = clampInt(
    cfg.timerSeconds ?? cfg.timeLimitSeconds ?? task?.timeLimitSeconds,
    10,
    600,
    DEFAULT_TIMER_SECONDS
  );

  const secretAnswers = useMemo(() => {
    const fromCfg = normalizeList(cfg.secretAnswers);
    const fromTop = normalizeList(task?.secretAnswers);
    const fromPrompt = normalizeList(cfg.answerPool);
    const list = fromCfg.length ? fromCfg : fromTop.length ? fromTop : fromPrompt;
    return list.length ? list : ["Mystery"];
  }, [cfg.secretAnswers, cfg.answerPool, task?.secretAnswers]);

  const allowSkip = cfg.allowSkip !== false;
  const holdToReveal = cfg.holdToReveal !== false;

  const [roundIndex, setRoundIndex] = useState(0);
  const secret = secretAnswers[roundIndex] || secretAnswers[0] || "Mystery";

  const [timerStarted, setTimerStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(timerSeconds);
  const timerRef = useRef(null);

  const [showSecret, setShowSecret] = useState(false);
  const [questions, setQuestions] = useState([]); // { text, answer: "Yes"|"No"|null }
  const [questionInput, setQuestionInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [guessCount, setGuessCount] = useState(0);

  const [roundOver, setRoundOver] = useState(false);
  const [result, setResult] = useState(null); // { ok:boolean, message:string }
  const [overlaySeconds, setOverlaySeconds] = useState(0);
  const overlayRef = useRef(null);

  // Sounds (safe defaults; if files missing, use-sound won’t crash hard, but it may warn)
  const [playBeep] = useSound("/sounds/beep.mp3", { volume: 0.35 });
  const [playBuzzer] = useSound("/sounds/buzzer.mp3", { volume: 0.5 });
  const [playYes] = useSound("/sounds/yes-ding.mp3", { volume: 0.6 });
  const [playNo] = useSound("/sounds/no-buzzer.mp3", { volume: 0.6 });
  const [playCorrect] = useSound("/sounds/correct.mp3", { volume: 0.65 });
  const [playWrong] = useSound("/sounds/wrong.mp3", { volume: 0.65 });

  // Reset round state when roundIndex changes
  useEffect(() => {
    setTimerStarted(false);
    setTimeLeft(timerSeconds);
    setShowSecret(false);
    setQuestions([]);
    setQuestionInput("");
    setGuessInput("");
    setGuessCount(0);
    setRoundOver(false);
    setResult(null);
    setOverlaySeconds(0);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    if (overlayRef.current) clearInterval(overlayRef.current);
    overlayRef.current = null;
  }, [roundIndex, timerSeconds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (overlayRef.current) clearInterval(overlayRef.current);
    };
  }, []);

  const startOverlay = (seconds = 10) => {
    const s = clampInt(seconds, 3, 30, 10);
    setOverlaySeconds(s);
    if (overlayRef.current) clearInterval(overlayRef.current);
    overlayRef.current = setInterval(() => {
      setOverlaySeconds((prev) => {
        if (prev <= 1) {
          clearInterval(overlayRef.current);
          overlayRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const endRound = ({ ok, message }) => {
    setRoundOver(true);
    setResult({ ok: !!ok, message: String(message || "") });
    setShowSecret(false);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    startOverlay(10);
  };

  const maybeStartTimer = () => {
    if (timerStarted || roundOver) return;

    setTimerStarted(true);
    setTimeLeft(timerSeconds);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          playBuzzer();
          endRound({ ok: false, message: `Time’s up! The answer was: ${secret}` });
          return 0;
        }
        if (prev <= 11) playBeep();
        return prev - 1;
      });
    }, 1000);
  };

  const onRevealDown = () => {
    if (disabled || roundOver) return;
    setShowSecret(true);
    maybeStartTimer();
  };

  const onRevealUp = () => {
    setShowSecret(false);
  };

  const handleAsk = () => {
    if (disabled || roundOver) return;
    const q = String(questionInput || "").trim();
    if (!q) return;

    setQuestions((prev) => [...prev, { text: q, answer: null }]);
    setQuestionInput("");
  };

  const handleAnswerYesNo = (val) => {
    if (disabled || roundOver) return;
    setQuestions((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (!last || last.answer) return prev;

      const next = [...prev];
      next[next.length - 1] = { ...last, answer: val };
      return next;
    });

    if (val === "Yes") playYes();
    else playNo();
  };

  const handleGuess = () => {
    if (disabled || roundOver) return;
    if (guessCount >= maxGuesses) return;

    const g = String(guessInput || "").trim();
    if (!g) return;

    const nextCount = guessCount + 1;
    setGuessCount(nextCount);

    const correct = g.toLowerCase() === String(secret).trim().toLowerCase();
    setGuessInput("");

    if (correct) {
      playCorrect();
      endRound({
        ok: true,
        message: `✅ Correct! You got it in ${nextCount} guess${nextCount === 1 ? "" : "es"}.`,
      });
      return;
    }

    playWrong();

    if (nextCount >= maxGuesses) {
      endRound({ ok: false, message: `Out of guesses! The answer was: ${secret}` });
    }
  };

  const canAnswerYesNo = !roundOver && questions.length > 0 && !questions[questions.length - 1]?.answer;

  const goNext = () => {
    if (overlaySeconds > 0) return; // don’t skip overlay countdown
    if (roundIndex < secretAnswers.length - 1) {
      setRoundIndex((r) => r + 1);
    } else {
      // Send a compact completion payload (TaskRunner will wrap if needed)
      onSubmit?.({
        type: "guess-who",
        gameComplete: true,
        rounds: secretAnswers.length,
      });
    }
  };

  const skipRound = () => {
    if (disabled || roundOver) return;
    if (!allowSkip) return;
    endRound({ ok: false, message: `Skipped. The answer was: ${secret}` });
  };

  const remainingGuesses = Math.max(0, maxGuesses - guessCount);

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div
        style={{
          border: `1px solid ${CONTRAST_BORDER}`,
          background: CONTRAST_BG_LIGHT,
          borderRadius: 16,
          padding: 14,
          color: CONTRAST_TEXT_DARK,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "1.15rem", fontWeight: 800, letterSpacing: 0.2 }}>
          🕵️ Guess Who?
        </div>
        <div style={{ marginTop: 6, fontSize: "0.95rem", opacity: 0.85 }}>
          Ask only <strong>Yes/No</strong> questions. The answerer can reveal the secret safely.
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: "#fff",
              fontSize: "0.9rem",
              fontWeight: 700,
            }}
          >
            Round {roundIndex + 1} / {secretAnswers.length}
          </div>

          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: "#fff",
              fontSize: "0.9rem",
              fontWeight: 700,
            }}
          >
            Guesses left: {remainingGuesses}
          </div>

          {timerStarted ? (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: "#fff",
                fontSize: "0.9rem",
                fontWeight: 800,
                color: timeLeft <= 10 ? "#dc2626" : CONTRAST_TEXT_DARK,
              }}
            >
              ⏱ {timeLeft}s
            </div>
          ) : (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: "#fff",
                fontSize: "0.9rem",
                fontWeight: 700,
              }}
            >
              ⏱ Starts on reveal
            </div>
          )}
        </div>
      </div>

      {/* Reveal button */}
      {!roundOver && (
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={holdToReveal ? onRevealDown : undefined}
            onMouseUp={holdToReveal ? onRevealUp : undefined}
            onMouseLeave={holdToReveal ? onRevealUp : undefined}
            onTouchStart={holdToReveal ? onRevealDown : undefined}
            onTouchEnd={holdToReveal ? onRevealUp : undefined}
            onClick={!holdToReveal ? () => { setShowSecret((s) => !s); maybeStartTimer(); } : undefined}
            style={{
              width: "100%",
              maxWidth: 520,
              padding: "14px 18px",
              borderRadius: 999,
              border: "none",
              background: showSecret ? "#16a34a" : CONTRAST_ACCENT,
              color: "#fff",
              fontWeight: 900,
              fontSize: "1.05rem",
              cursor: disabled ? "not-allowed" : "pointer",
              boxShadow: "0 8px 22px rgba(0,0,0,0.08)",
            }}
          >
            {holdToReveal
              ? showSecret
                ? `SECRET: ${secret}`
                : "Hold to Reveal Secret (starts timer)"
              : showSecret
              ? `SECRET: ${secret} (tap to hide)`
              : "Tap to Reveal Secret (starts timer)"}
          </button>

          {allowSkip && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={skipRound}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: `1px solid ${CONTRAST_BORDER}`,
                  background: "#fff",
                  color: CONTRAST_TEXT_DARK,
                  fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                Skip round
              </button>
            </div>
          )}
        </div>
      )}

      {/* Q/A log */}
      <div
        style={{
          marginTop: 14,
          border: `1px solid ${CONTRAST_BORDER}`,
          background: "#fff",
          borderRadius: 16,
          padding: 12,
          color: CONTRAST_TEXT_DARK,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Questions</div>

        <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {questions.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: "0.95rem" }}>
              No questions yet. Start with a broad yes/no question.
            </div>
          ) : (
            questions.map((q, idx) => (
              <div
                key={idx}
                style={{
                  padding: 10,
                  borderRadius: 14,
                  border: `1px solid ${CONTRAST_BORDER}`,
                  background: CONTRAST_BG_LIGHT,
                }}
              >
                <div style={{ fontWeight: 800 }}>{q.text}</div>
                <div style={{ marginTop: 6, fontSize: "0.95rem" }}>
                  {q.answer ? (
                    <span>
                      Answer:{" "}
                      <strong style={{ color: q.answer === "Yes" ? "#16a34a" : "#dc2626" }}>
                        {q.answer}
                      </strong>
                    </span>
                  ) : (
                    <span style={{ opacity: 0.75 }}>Awaiting answer…</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Yes/No buttons for latest unanswered */}
        {!roundOver && (
          <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={disabled || !canAnswerYesNo}
              onClick={() => handleAnswerYesNo("Yes")}
              style={{
                padding: "10px 16px",
                borderRadius: 999,
                border: "none",
                background: disabled || !canAnswerYesNo ? "#cbd5e1" : "#16a34a",
                color: "#fff",
                fontWeight: 900,
                cursor: disabled || !canAnswerYesNo ? "not-allowed" : "pointer",
                minWidth: 120,
              }}
            >
              Yes
            </button>
            <button
              type="button"
              disabled={disabled || !canAnswerYesNo}
              onClick={() => handleAnswerYesNo("No")}
              style={{
                padding: "10px 16px",
                borderRadius: 999,
                border: "none",
                background: disabled || !canAnswerYesNo ? "#cbd5e1" : "#dc2626",
                color: "#fff",
                fontWeight: 900,
                cursor: disabled || !canAnswerYesNo ? "not-allowed" : "pointer",
                minWidth: 120,
              }}
            >
              No
            </button>
          </div>
        )}
      </div>

      {/* Ask + Guess controls */}
      {!roundOver && (
        <div
          style={{
            marginTop: 14,
            border: `1px solid ${CONTRAST_BORDER}`,
            background: "#fff",
            borderRadius: 16,
            padding: 12,
            color: CONTRAST_TEXT_DARK,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Ask a yes/no question</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                  placeholder="e.g., Is it a person? Is it found in Canada?"
                  disabled={disabled}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${CONTRAST_BORDER}`,
                    outline: "none",
                    fontSize: "0.95rem",
                  }}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={handleAsk}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "none",
                    background: disabled ? "#94a3b8" : CONTRAST_ACCENT,
                    color: "#fff",
                    fontWeight: 900,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  Ask
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Make a guess</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGuess()}
                  placeholder="Type your guess…"
                  disabled={disabled || guessCount >= maxGuesses}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${CONTRAST_BORDER}`,
                    outline: "none",
                    fontSize: "0.95rem",
                  }}
                />
                <button
                  type="button"
                  disabled={disabled || guessCount >= maxGuesses}
                  onClick={handleGuess}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "none",
                    background: disabled || guessCount >= maxGuesses ? "#94a3b8" : "#111827",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: disabled || guessCount >= maxGuesses ? "not-allowed" : "pointer",
                  }}
                >
                  Guess
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* End-of-round overlay */}
      {roundOver && result && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            textAlign: "center",
            color: "#fff",
          }}
        >
          <div style={{ width: "min(680px, 100%)" }}>
            <div style={{ fontSize: "2.1rem", fontWeight: 1000, lineHeight: 1.1 }}>
              {result.ok ? "🎉 Nice work!" : "⏳ Round over"}
            </div>
            <div style={{ marginTop: 14, fontSize: "1.25rem", opacity: 0.95 }}>
              {result.message}
            </div>

            <div style={{ marginTop: 18, fontSize: "1.05rem", opacity: 0.9 }}>
              {overlaySeconds > 0 ? (
                <>Next round in <strong>{overlaySeconds}s</strong>…</>
              ) : (
                <>Ready.</>
              )}
            </div>

            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                onClick={goNext}
                disabled={overlaySeconds > 0}
                style={{
                  padding: "12px 18px",
                  borderRadius: 999,
                  border: "none",
                  background: overlaySeconds > 0 ? "#64748b" : "#16a34a",
                  color: "#fff",
                  fontWeight: 1000,
                  cursor: overlaySeconds > 0 ? "not-allowed" : "pointer",
                  minWidth: 220,
                }}
              >
                {roundIndex < secretAnswers.length - 1 ? "Next round →" : "Finish →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
