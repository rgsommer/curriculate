// student-app/src/components/ui/BuzzButton.jsx
import React from "react";

/**
 * BuzzButton
 * Big, square-ish buzzer button.
 *
 * Parent should set the width (example: width: "min(30vw, 220px)").
 * The button uses aspectRatio: 1 / 1 so it stays square.
 */
export default function BuzzButton({ label, onClick, disabled = false, active = false }) {
  const style = {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: 24,
    border: active ? "3px solid rgba(37,99,235,0.65)" : "2px solid rgba(15,23,42,0.18)",
    background: disabled
      ? "rgba(15,23,42,0.06)"
      : active
      ? "linear-gradient(135deg, rgba(37,99,235,0.22), rgba(59,130,246,0.08))"
      : "linear-gradient(135deg, rgba(255,255,255,1), rgba(241,245,249,1))",
    boxShadow: active
      ? "0 18px 40px rgba(37,99,235,0.18)"
      : "0 14px 34px rgba(2,6,23,0.12)",
    color: "#0f172a",
    fontWeight: 1000,
    fontSize: 18,
    padding: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        if (disabled) return;
        onClick?.();
      }}
      style={style}
      aria-label={`Buzz: ${String(label || "")}`}
      title={disabled ? "Buzz locked" : "Buzz"}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 1000, letterSpacing: 0.5, textTransform: "uppercase", color: "#475569" }}>
          BUZZ
        </div>
        <div style={{ marginTop: 4, fontSize: 20, fontWeight: 1100, lineHeight: 1.05 }}>
          {String(label || "Player")}
        </div>
      </div>
    </button>
  );
}
