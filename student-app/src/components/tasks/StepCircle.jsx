// student-app/src/components/tasks/StepCircle.jsx
// Shared colored-circle step indicator for "How to play" instruction blocks.
// Usage: <StepCircle n={1} />  — renders a 28px colored circle with the step number.
import React from "react";

const STEP_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
];

export default function StepCircle({ n, size = 28 }) {
  const bg = STEP_COLORS[(n - 1) % STEP_COLORS.length];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        fontWeight: 900,
        fontSize: Math.round(size * 0.52),
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none",
      }}
      aria-label={`Step ${n}`}
    >
      {n}
    </span>
  );
}
