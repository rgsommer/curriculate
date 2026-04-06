import React, { useEffect, useRef, useState } from "react";

/**
 * Animated score counter that rolls up to the target value.
 * On increase: big pop + color flash + floating delta indicator.
 * On decrease: smaller shrink flash.
 */
export default function AnimatedScore({ value = 0, suffix = " pts", duration = 800 }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef(null);
  const [popState, setPopState] = useState(null); // null | "up" | "down"
  const [delta, setDelta] = useState(null); // "+12" floating label

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;

    if (from === to) return;

    const diff = to - from;
    const isUp = diff > 0;

    // Show floating delta label
    if (isUp) {
      setDelta(`+${diff}`);
      setTimeout(() => setDelta(null), 1100);
    }

    // Trigger pop animation
    setPopState(isUp ? "up" : "down");
    setTimeout(() => setPopState(null), 600);

    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + diff * eased);
      setDisplay(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  const scaleUp = popState === "up" ? 1.75 : popState === "down" ? 0.85 : 1;
  const color = popState === "up" ? "#22c55e" : popState === "down" ? "#ef4444" : "inherit";

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {/* Floating delta */}
      {delta && (
        <span
          key={delta + Date.now()}
          style={{
            position: "absolute",
            top: "-1.6em",
            left: "50%",
            transform: "translateX(-50%)",
            color: "#22c55e",
            fontWeight: 900,
            fontSize: "1.1em",
            pointerEvents: "none",
            animation: "floatUp 1.1s ease-out forwards",
            whiteSpace: "nowrap",
          }}
        >
          {delta}
        </span>
      )}

      <span
        style={{
          display: "inline-block",
          transition: "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.25s ease",
          transform: `scale(${scaleUp})`,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {display}{suffix}
      </span>

      {/* Keyframes injected once */}
      <style>{`
        @keyframes floatUp {
          0%   { opacity: 1; transform: translateX(-50%) translateY(0);    }
          100% { opacity: 0; transform: translateX(-50%) translateY(-2em); }
        }
      `}</style>
    </span>
  );
}
