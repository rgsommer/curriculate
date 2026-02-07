// app/src/components/ProgressFillButton.jsx
import React from "react";

export default function ProgressFillButton({
  children,
  progress = 0, // 0..1
  disabled = false,
  onClick,
  style,
  className = "",
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;

  const bg = `linear-gradient(90deg, rgba(34,197,94,0.95) ${pct}%, rgba(255,255,255,0.10) ${pct}%)`;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={className}
      style={{
        position: "relative",
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: bg,
        transition: "background 140ms linear",
        color: "white",
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
