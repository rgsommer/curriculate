// student-app/src/components/tasks/ui/SmoothCountdownBar.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * SmoothCountdownBar
 * A tiny, reusable progress bar that smoothly fills over a duration.
 *
 * Props:
 * - durationMs: number (total duration in ms)
 * - running: boolean (start/stop)
 * - resetKey: any (change to reset progress)
 * - height: number (px)
 * - onDone: function() called once at completion
 * - style, trackStyle, fillStyle: inline style overrides
 */
export default function SmoothCountdownBar({
  durationMs = 5000,
  running = true,
  resetKey,
  height = 10,
  onDone,
  style,
  trackStyle,
  fillStyle,
}) {
  const [p, setP] = useState(0);
  const doneRef = useRef(false);
  const rafRef = useRef(null);
  const startRef = useRef(null);

  const safeDuration = Math.max(1, Number(durationMs) || 1);

  useEffect(() => {
    // reset
    setP(0);
    doneRef.current = false;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, [resetKey, safeDuration]);

  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = (t) => {
      if (!startRef.current) startRef.current = t;
      const elapsed = t - startRef.current;
      const next = Math.min(1, elapsed / safeDuration);
      setP(next);

      if (next >= 1) {
        if (!doneRef.current) {
          doneRef.current = true;
          try {
            onDone && onDone();
          } catch (_) {}
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [running, safeDuration, onDone]);

  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: 999,
        background: "rgba(15,23,42,0.10)",
        overflow: "hidden",
        ...trackStyle,
        ...style,
      }}
      role="progressbar"
      aria-label="countdown"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={p}
    >
      <div
        style={{
          height: "100%",
          width: `${(p * 100).toFixed(2)}%`,
          borderRadius: 999,
          background: "linear-gradient(90deg, rgba(56,189,248,1), rgba(52,211,153,1))",
          ...fillStyle,
        }}
      />
    </div>
  );
}
