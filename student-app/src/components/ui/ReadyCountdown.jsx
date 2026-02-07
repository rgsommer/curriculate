// student-app/src/components/ui/ReadyCountdown.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * ReadyCountdown
 * A reusable "1-2-3-GO" pre-start countdown.
 *
 * Props:
 * - enabled: boolean            // when true, countdown begins (or resumes if already running)
 * - seconds?: number            // default 3 (shows 3,2,1,GO)
 * - onGo?: () => void           // called once when GO triggers
 * - onDone?: () => void         // called once at the end (same moment as onGo, but separate for convenience)
 * - label?: string              // optional top label
 * - showBeep?: boolean          // plays a short beep on GO (default true)
 */
export default function ReadyCountdown({
  enabled,
  seconds = 3,
  onGo,
  onDone,
  label = "Get ready…",
  showBeep = true,
}) {
  const [value, setValue] = useState(null); // number | "GO" | null
  const [running, setRunning] = useState(false);
  const firedRef = useRef(false);
  const timerRef = useRef(null);

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRunning(false);
    setValue(null);
    firedRef.current = false;
  };

  const beep = () => {
    if (!showBeep) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close?.();
      }, 120);
    } catch {
      // ignore (autoplay restrictions, etc.)
    }
  };

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    // start fresh each time enabled flips true
    stop();
    setRunning(true);

    let t = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 3;
    setValue(t);

    timerRef.current = window.setInterval(() => {
      t -= 1;

      if (t > 0) {
        setValue(t);
        return;
      }

      // GO moment
      if (!firedRef.current) {
        firedRef.current = true;
        setValue("GO");
        beep();
        onGo?.();
        onDone?.();
      }

      // clear shortly after showing GO
      window.setTimeout(() => stop(), 650);
    }, 900);

    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, seconds]);

  if (!running || value == null) return null;

  const isGo = value === "GO";

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(15,23,42,0.12)",
        background:
          "radial-gradient(700px 240px at 20% 0%, rgba(56,189,248,0.18), transparent 60%), rgba(255,255,255,0.88)",
        padding: "14px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        boxShadow: "0 18px 60px rgba(15,23,42,0.10)",
      }}
      aria-label="Countdown"
    >
      <div style={{ fontWeight: 900, opacity: 0.85 }}>{label}</div>

      <div
        style={{
          fontVariantNumeric: "tabular-nums",
          fontWeight: 1100,
          fontSize: 22,
          letterSpacing: 1,
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid rgba(15,23,42,0.12)",
          background: isGo
            ? "linear-gradient(135deg, rgba(34,197,94,0.90), rgba(56,189,248,0.75))"
            : "rgba(15,23,42,0.06)",
          color: isGo ? "white" : "rgba(15,23,42,0.88)",
          transform: isGo ? "scale(1.06)" : "scale(1)",
          transition: "transform 160ms ease",
        }}
      >
        {value}
      </div>
    </div>
  );
}
