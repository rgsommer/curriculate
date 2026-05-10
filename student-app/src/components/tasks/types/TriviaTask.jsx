// student-app/src/components/tasks/types/TriviaTask.jsx
import React, { useState } from "react";

/**
 * Trivia Task — Fun trivia break with three presentation modes:
 *
 * 1) "bluff" (Bluff Catcher)  — 3 "facts" shown, pick the fake one
 * 2) "truefalse" (True/False) — rapid-fire statement, tap True or False
 * 3) "closerto" (Closer To)   — estimation question, pick which value is closer
 *
 * AI generates two rounds: one subject-related, one pop culture / student world.
 * No scoring — this is a fun breather task like riddle.
 */
export default function TriviaTask({ task, onSubmit, disabled }) {
  const cfg = task?.config || {};

  // Rounds: array of trivia items
  const rounds = cfg.rounds || [];
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const round = rounds[currentRound] || null;
  const mode = round?.mode || cfg.mode || "bluff";

  function handleSelect(answer) {
    if (revealed || disabled) return;
    setSelectedAnswer(answer);
  }

  // Lazy WebAudio click — sound on correct / wrong reveal so the
  // task feels alive (tester: 'maybe correct answer sounds?').
  const playTriviaTone = (kind) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playTriviaTone._ctx || (playTriviaTone._ctx = new Ctx());
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "correct" ? "triangle" : "sawtooth";
      if (kind === "correct") {
        osc.frequency.setValueAtTime(660, t0);
        osc.frequency.exponentialRampToValueAtTime(990, t0 + 0.18);
      } else if (kind === "wrong") {
        osc.frequency.setValueAtTime(280, t0);
        osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.22);
      } else { // victory
        osc.frequency.setValueAtTime(523, t0);
        osc.frequency.linearRampToValueAtTime(784, t0 + 0.18);
        osc.frequency.linearRampToValueAtTime(1046, t0 + 0.36);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    } catch {}
  };

  function handleReveal() {
    if (revealed) return;
    setRevealed(true);
    // Check if correct + play matching sound
    let isCorrect = false;
    if (mode === "bluff") {
      isCorrect = selectedAnswer === round.fakeIndex;
    } else if (mode === "truefalse") {
      isCorrect = selectedAnswer === round.answer;
    } else if (mode === "closerto") {
      isCorrect = selectedAnswer === round.correctChoice;
    }
    if (isCorrect) setScore((s) => s + 1);
    playTriviaTone(isCorrect ? "correct" : "wrong");
  }

  function handleNext() {
    if (currentRound + 1 < rounds.length) {
      setCurrentRound((r) => r + 1);
      setSelectedAnswer(null);
      setRevealed(false);
    } else {
      setFinished(true);
      playTriviaTone("victory");
    }
  }

  function handleContinue() {
    if (onSubmit) {
      onSubmit({ answer: "completed", score, totalRounds: rounds.length, autoComplete: true });
    }
  }

  // ── Finished state ──
  if (finished || rounds.length === 0) {
    const isPerfect = rounds.length > 0 && score === rounds.length;
    return (
      <div style={styles.container}>
        <style>{`
          @keyframes trivPop {
            0% { transform: scale(0.6) rotate(-12deg); opacity: 0; }
            60% { transform: scale(1.15) rotate(4deg); opacity: 1; }
            100% { transform: scale(1) rotate(0); opacity: 1; }
          }
          @keyframes trivBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          @keyframes trivConfettiFall {
            0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
            10% { opacity: 1; }
            100% { transform: translateY(420px) rotate(540deg); opacity: 0; }
          }
        `}</style>

        {/* Confetti only on a perfect score */}
        {isPerfect && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
            {Array.from({ length: 24 }).map((_, i) => {
              const colors = ["#fbbf24", "#22c55e", "#3b82f6", "#a855f7", "#ef4444", "#06b6d4"];
              const left = 5 + (i * 4.1) % 90;
              const delay = (i * 0.07) % 1.4;
              const dur = 1.8 + ((i * 0.13) % 1.2);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    top: -20,
                    width: 8,
                    height: 14,
                    background: colors[i % colors.length],
                    borderRadius: 2,
                    animation: `trivConfettiFall ${dur}s linear ${delay}s infinite`,
                    transform: "rotate(15deg)",
                  }}
                />
              );
            })}
          </div>
        )}

        <div
          style={{
            fontSize: "4rem",
            animation: "trivPop 0.5s ease-out, trivBounce 1.4s ease-in-out 0.5s infinite",
          }}
        >
          {isPerfect ? "🏆" : score >= rounds.length / 2 ? "🎉" : "🧠"}
        </div>
        <div style={styles.tag}>{isPerfect ? "PERFECT SCORE!" : "Trivia Complete!"}</div>
        {rounds.length > 0 && (
          <div style={styles.scoreBox}>
            {score}/{rounds.length} correct
          </div>
        )}
        <button onClick={handleContinue} disabled={disabled} style={styles.continueBtn}>
          Continue →
        </button>
      </div>
    );
  }

  // ── Render by mode ──
  return (
    <div style={styles.container}>
      <div style={{ fontSize: "2.5rem" }}>
        {mode === "bluff" ? "🕵️" : mode === "truefalse" ? "⚡" : "📏"}
      </div>

      <div style={styles.tag}>
        {mode === "bluff"
          ? "Bluff Catcher"
          : mode === "truefalse"
          ? "True or False"
          : "Closer To"}
      </div>

      <div style={styles.roundIndicator}>
        {round.category === "pop" ? "🎮 Pop Culture" : "📚 Subject"} — Round {currentRound + 1}/{rounds.length}
      </div>

      {/* ── BLUFF CATCHER ── */}
      {mode === "bluff" && (
        <div style={{ width: "100%", maxWidth: 480 }}>
          <div style={styles.questionText}>
            Two of these are real. One is fake. Spot the bluff!
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {(round.facts || []).map((fact, i) => {
              const isSelected = selectedAnswer === i;
              const isFake = i === round.fakeIndex;
              let bg = "rgba(100,116,139,0.12)";
              let border = "1px solid rgba(100,116,139,0.2)";
              let color = "#f1f5f9";

              if (revealed && isFake) {
                bg = "rgba(239,68,68,0.18)";
                border = "1px solid rgba(239,68,68,0.5)";
                color = "#fca5a5";
              } else if (revealed && isSelected && !isFake) {
                bg = "rgba(251,191,36,0.15)";
                border = "1px solid rgba(251,191,36,0.4)";
              } else if (isSelected) {
                bg = "rgba(59,130,246,0.2)";
                border = "1px solid rgba(59,130,246,0.5)";
              }

              return (
                <button
                  key={i}
                  onClick={() => handleSelect(i)}
                  disabled={revealed || disabled}
                  style={{
                    ...styles.optionBtn,
                    background: bg,
                    border,
                    color,
                    cursor: revealed || disabled ? "default" : "pointer",
                  }}
                >
                  {fact}
                  {revealed && isFake && <span style={{ marginLeft: 8 }}>← FAKE!</span>}
                </button>
              );
            })}
          </div>

          {revealed && round.explanation && (
            <div style={styles.explanation}>{round.explanation}</div>
          )}
        </div>
      )}

      {/* ── TRUE / FALSE ── */}
      {mode === "truefalse" && (
        <div style={{ width: "100%", maxWidth: 480 }}>
          <div style={styles.statementBox}>{round.statement}</div>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 16 }}>
            {[true, false].map((val) => {
              const isSelected = selectedAnswer === val;
              const isCorrect = val === round.answer;
              let bg = "rgba(100,116,139,0.12)";
              let border = "1px solid rgba(100,116,139,0.2)";

              if (revealed && isCorrect) {
                bg = "rgba(34,197,94,0.2)";
                border = "1px solid rgba(34,197,94,0.5)";
              } else if (revealed && isSelected && !isCorrect) {
                bg = "rgba(239,68,68,0.18)";
                border = "1px solid rgba(239,68,68,0.5)";
              } else if (isSelected) {
                bg = "rgba(59,130,246,0.2)";
                border = "1px solid rgba(59,130,246,0.5)";
              }

              return (
                <button
                  key={String(val)}
                  onClick={() => handleSelect(val)}
                  disabled={revealed || disabled}
                  style={{
                    ...styles.tfBtn,
                    background: bg,
                    border,
                    cursor: revealed || disabled ? "default" : "pointer",
                  }}
                >
                  {val ? "✅ True" : "❌ False"}
                </button>
              );
            })}
          </div>

          {revealed && round.explanation && (
            <div style={styles.explanation}>{round.explanation}</div>
          )}
        </div>
      )}

      {/* ── CLOSER TO ── */}
      {mode === "closerto" && (
        <div style={{ width: "100%", maxWidth: 480 }}>
          <div style={styles.questionText}>{round.question}</div>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 16 }}>
            {(round.choices || []).map((choice, i) => {
              const isSelected = selectedAnswer === i;
              const isCorrect = i === round.correctChoice;
              let bg = "rgba(100,116,139,0.12)";
              let border = "1px solid rgba(100,116,139,0.2)";

              if (revealed && isCorrect) {
                bg = "rgba(34,197,94,0.2)";
                border = "1px solid rgba(34,197,94,0.5)";
              } else if (revealed && isSelected && !isCorrect) {
                bg = "rgba(239,68,68,0.18)";
                border = "1px solid rgba(239,68,68,0.5)";
              } else if (isSelected) {
                bg = "rgba(59,130,246,0.2)";
                border = "1px solid rgba(59,130,246,0.5)";
              }

              return (
                <button
                  key={i}
                  onClick={() => handleSelect(i)}
                  disabled={revealed || disabled}
                  style={{
                    ...styles.tfBtn,
                    background: bg,
                    border,
                    cursor: revealed || disabled ? "default" : "pointer",
                    minWidth: 120,
                  }}
                >
                  {choice}
                </button>
              );
            })}
          </div>

          {revealed && (
            <div style={styles.explanation}>
              The answer is <strong>{round.actualAnswer}</strong>. {round.explanation || ""}
            </div>
          )}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ marginTop: 16 }}>
        {!revealed ? (
          <button
            onClick={handleReveal}
            disabled={selectedAnswer === null || disabled}
            style={{
              ...styles.primaryBtn,
              opacity: selectedAnswer === null ? 0.5 : 1,
              cursor: selectedAnswer === null ? "not-allowed" : "pointer",
            }}
          >
            Check Answer
          </button>
        ) : (
          <button onClick={handleNext} disabled={disabled} style={styles.nextBtn}>
            {currentRound + 1 < rounds.length ? "Next →" : "See Results"}
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    padding: "24px 16px",
    textAlign: "center",
    gap: 14,
  },
  tag: {
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#38bdf8",
  },
  roundIndicator: {
    fontSize: "0.8rem",
    color: "#94a3b8",
    fontWeight: 600,
  },
  questionText: {
    fontSize: "1.15rem",
    fontWeight: 600,
    lineHeight: 1.5,
    color: "#f1f5f9",
    padding: "16px 20px",
    background: "rgba(56,189,248,0.1)",
    borderRadius: 14,
    border: "1px solid rgba(56,189,248,0.2)",
  },
  statementBox: {
    fontSize: "1.2rem",
    fontWeight: 600,
    lineHeight: 1.5,
    color: "#f1f5f9",
    padding: "20px 24px",
    background: "rgba(56,189,248,0.1)",
    borderRadius: 16,
    border: "1px solid rgba(56,189,248,0.25)",
    maxWidth: 440,
    margin: "0 auto",
  },
  optionBtn: {
    padding: "14px 18px",
    borderRadius: 12,
    fontSize: "0.95rem",
    fontWeight: 600,
    textAlign: "left",
    lineHeight: 1.4,
    transition: "all 0.15s ease",
  },
  tfBtn: {
    padding: "16px 28px",
    borderRadius: 14,
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#f1f5f9",
    transition: "all 0.15s ease",
  },
  explanation: {
    marginTop: 14,
    padding: "12px 16px",
    background: "rgba(34,197,94,0.1)",
    borderRadius: 12,
    border: "1px solid rgba(34,197,94,0.2)",
    color: "#86efac",
    fontSize: "0.9rem",
    lineHeight: 1.5,
    fontWeight: 500,
  },
  scoreBox: {
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "#38bdf8",
    padding: "12px 24px",
    background: "rgba(56,189,248,0.1)",
    borderRadius: 14,
    border: "1px solid rgba(56,189,248,0.25)",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #38bdf8, #0284c7)",
    border: "none",
    borderRadius: 14,
    padding: "14px 36px",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 700,
    boxShadow: "0 4px 16px rgba(56,189,248,0.3)",
    transition: "transform 0.15s ease",
  },
  nextBtn: {
    background: "linear-gradient(135deg, #22c55e, #16a34a)",
    border: "none",
    borderRadius: 14,
    padding: "12px 32px",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
  },
  continueBtn: {
    marginTop: 8,
    background: "linear-gradient(135deg, #22c55e, #16a34a)",
    border: "none",
    borderRadius: 14,
    padding: "12px 32px",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
  },
};
