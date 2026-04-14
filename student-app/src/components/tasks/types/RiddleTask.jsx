// student-app/src/components/tasks/types/RiddleTask.jsx
import React, { useState } from "react";

/**
 * Riddle Task — Comic relief, no scoring, no input.
 *
 * Shows the riddle, optional hint, a "Reveal Answer" button,
 * and after reveal a "Continue" button that auto-submits.
 */
export default function RiddleTask({ task, onSubmit, disabled }) {
  const [showHint, setShowHint] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const cfg = task?.config || {};
  const riddleText = cfg.riddle || task?.prompt || "No riddle provided!";
  const answer = cfg.answer || "¯\\_(ツ)_/¯";
  const hint = cfg.hint || null;

  const handleReveal = () => setRevealed(true);

  const handleContinue = () => {
    if (onSubmit) {
      onSubmit({ answer: "revealed", autoComplete: true });
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      padding: "24px 16px",
      textAlign: "center",
      gap: 20,
    }}>
      {/* Riddle emoji header */}
      <div style={{ fontSize: "3rem" }}>🤔</div>

      <div style={{
        fontSize: "0.75rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 2,
        color: "#a78bfa",
      }}>
        Riddle Time!
      </div>

      {/* The riddle */}
      <div style={{
        fontSize: "1.25rem",
        fontWeight: 600,
        lineHeight: 1.5,
        color: "#f1f5f9",
        maxWidth: 440,
        padding: "20px 24px",
        background: "rgba(139,92,246,0.15)",
        borderRadius: 16,
        border: "1px solid rgba(139,92,246,0.3)",
      }}>
        {riddleText}
      </div>

      {/* Hint button + hint text */}
      {hint && !revealed && (
        <div style={{ minHeight: 40 }}>
          {!showHint ? (
            <button
              onClick={() => setShowHint(true)}
              style={{
                background: "rgba(251,191,36,0.15)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 10,
                padding: "8px 18px",
                color: "#fbbf24",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              💡 Need a hint?
            </button>
          ) : (
            <div style={{
              fontSize: "0.9rem",
              color: "#fbbf24",
              fontStyle: "italic",
              padding: "8px 16px",
              background: "rgba(251,191,36,0.1)",
              borderRadius: 10,
            }}>
              Hint: {hint}
            </div>
          )}
        </div>
      )}

      {/* Reveal / Answer section */}
      {!revealed ? (
        <button
          onClick={handleReveal}
          disabled={disabled}
          style={{
            background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
            border: "none",
            borderRadius: 14,
            padding: "14px 36px",
            color: "#fff",
            fontSize: "1.1rem",
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            boxShadow: "0 4px 16px rgba(139,92,246,0.4)",
            transition: "transform 0.15s ease",
          }}
        >
          Reveal Answer
        </button>
      ) : (
        <>
          <div style={{
            fontSize: "2rem",
            animation: "riddleReveal 0.4s ease-out",
          }}>
            🎉
          </div>
          <div style={{
            fontSize: "1.3rem",
            fontWeight: 700,
            color: "#22c55e",
            maxWidth: 440,
            padding: "16px 24px",
            background: "rgba(34,197,94,0.12)",
            borderRadius: 14,
            border: "1px solid rgba(34,197,94,0.3)",
          }}>
            {answer}
          </div>
          <button
            onClick={handleContinue}
            disabled={disabled}
            style={{
              marginTop: 8,
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              border: "none",
              borderRadius: 14,
              padding: "12px 32px",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
            }}
          >
            Continue →
          </button>
        </>
      )}

      <style>{`
        @keyframes riddleReveal {
          0% { transform: scale(0.3) rotate(-10deg); opacity: 0; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
