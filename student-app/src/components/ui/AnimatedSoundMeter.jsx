// student-app/src/components/ui/AnimatedSoundMeter.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * AnimatedSoundMeter
 * Props:
 * - active: boolean (true when mic/listening is on)
 * - height?: number (px)
 * - label?: string
 */
export default function AnimatedSoundMeter({
  active,
  height = 10,
  label = "🎧 Listening…",
}) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);

  // Try to attach WebAudio analyser (real amplitude)
  useEffect(() => {
    if (!active) return cleanup;

    let cancelled = false;

    async function initAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();

        analyser.fftSize = 256;
        source.connect(analyser);

        analyserRef.current = analyser;
        dataRef.current = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(dataRef.current);
          let sum = 0;
          for (let i = 0; i < dataRef.current.length; i++) {
            const v = (dataRef.current[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / dataRef.current.length);
          setLevel(Math.min(1, rms * 3));
          rafRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch {
        // WebAudio blocked → fallback animation
        fallbackAnimate();
      }
    }

    function fallbackAnimate() {
      const tick = () => {
        if (cancelled) return;
        setLevel(0.25 + Math.random() * 0.65);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    }

    function cleanup() {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setLevel(0);
    }

    initAudio();
    return cleanup;
  }, [active]);

  if (!active) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(15,23,42,0.12)",
      }}
      aria-label="Microphone listening indicator"
    >
      <div style={{ fontWeight: 900, fontSize: 12 }}>{label}</div>
      <div
        style={{
          flex: 1,
          height,
          borderRadius: 999,
          overflow: "hidden",
          background: "rgba(15,23,42,0.12)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(level * 100)}%`,
            transition: "width 80ms linear",
            background:
              "linear-gradient(90deg, rgba(56,189,248,0.95), rgba(34,197,94,0.85))",
          }}
        />
      </div>
    </div>
  );
}
