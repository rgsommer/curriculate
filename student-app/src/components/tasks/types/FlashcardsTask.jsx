// student-app/src/components/tasks/types/FlashcardsTask.jsx
import React, { useState } from "react";

export default function FlashcardsTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const cards = Array.isArray(task?.cards) ? task.cards : [];

  // Track which card is shown & whether it is flipped
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  if (!cards.length) {
    return (
      <div style={{ padding: 12 }}>
        <strong>No flashcards available.</strong>
      </div>
    );
  }

  const current = cards[index];

  const goNext = () => {
    if (index < cards.length - 1) {
      setIsFlipped(false);
      setIndex(index + 1);
    }
  };

  const goPrev = () => {
    if (index > 0) {
      setIsFlipped(false);
      setIndex(index - 1);
    }
  };

  const handleSubmit = () => {
    // Flashcards normally 0-point tasks, but allow behaviour in case teacher wants it scored.
    onSubmit && onSubmit({ viewedCards: index + 1 });
  };

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      {/* Deck title */}
      {task?.prompt && (
        <p
          style={{
            fontSize: "0.95rem",
            marginBottom: 10,
            color: "#334155",
          }}
        >
          {task.prompt}
        </p>
      )}

      {/* Card index indicator */}
      <div style={{ marginBottom: 8, fontSize: "0.85rem", color: "#475569" }}>
        Card <strong>{index + 1}</strong> of {cards.length}
      </div>

      {/* ACTUAL FLASHCARD */}
      <div
        className="flashcard-container"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <div className={`flashcard ${isFlipped ? "flipped" : ""}`}>
          {/* FRONT – Question */}
          {!isFlipped && (
            <div style={{ position: "relative", zIndex: 2 }}>
              {current.question}
            </div>
          )}

          {/* BACK – Answer */}
          <div className="flashcard-back">{current.answer}</div>
        </div>
      </div>

      {/* Navigation buttons */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <button
          onClick={goPrev}
          disabled={disabled || index === 0}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: "0.85rem",
            background: index === 0 ? "#cbd5e1" : "#3b82f6",
            color: index === 0 ? "#475569" : "#ffffff",
            border: "none",
            cursor: index === 0 ? "default" : "pointer",
          }}
        >
          ◀ Prev
        </button>

        <button
          onClick={goNext}
          disabled={disabled || index >= cards.length - 1}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: "0.85rem",
            background:
              index >= cards.length - 1 ? "#cbd5e1" : "#3b82f6",
            color:
              index >= cards.length - 1 ? "#475569" : "#ffffff",
            border: "none",
            cursor:
              index >= cards.length - 1 ? "default" : "pointer",
          }}
        >
          Next ▶
        </button>
      </div>

      {/* Submit button */}
      <div style={{ marginTop: 18 }}>
        <button
          disabled={disabled}
          onClick={handleSubmit}
          style={{
            padding: "8px 18px",
            borderRadius: 999,
            fontSize: "0.9rem",
            fontWeight: 600,
            background: "#16a34a",
            color: "white",
            border: "none",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
