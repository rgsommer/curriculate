import React, { useEffect, useRef, useState } from "react";

/**
 * Animated score counter that rolls up/down to the target value.
 * Shows a brief pulse animation on change.
 */
export default function AnimatedScore({ value = 0, suffix = " pts", duration = 600 }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;

    if (from === to) return;

    // Trigger pulse animation
    setPulse(true);
    const pulseTimer = setTimeout(() => setPulse(false), 500);

    const diff = to - from;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out curve for satisfying deceleration
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
      clearTimeout(pulseTimer);
    };
  }, [value, duration]);

  return (
    <span
      style={{
        display: "inline-block",
        transition: "transform 0.15s ease-out",
        transform: pulse ? "scale(1.25)" : "scale(1)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {display}{suffix}
    </span>
  );
}
