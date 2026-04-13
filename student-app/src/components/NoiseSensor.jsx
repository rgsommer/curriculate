// student-app/src/components/NoiseSensor.jsx
import React, { useEffect, useRef } from "react";

/**
 * Invisible component that captures microphone level and emits
 * throttled noise:sample events to the backend via socket.
 *
 * Props:
 *   active   – whether to capture (mic only opens when true)
 *   roomCode – current room code
 *   socket   – socket.io instance
 */
function NoiseSensor({ active, roomCode, socket }) {
  const cleanupRef = useRef(null);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    if (!active || !roomCode || !socket) return;

    let cancelled = false;
    let audioCtx = null;
    let stream = null;
    let analyser = null;
    let rafId = null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const buf = new Uint8Array(analyser.frequencyBinCount);

        // Poll ~4 times/second (every 250ms via rAF + timestamp check)
        function loop() {
          if (cancelled) return;

          const now = Date.now();
          if (now - lastEmitRef.current >= 250) {
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i];
            const avg = sum / buf.length;
            const level = Math.min(100, Math.floor(avg * 0.5));

            socket.emit("noise:sample", { roomCode, level });
            lastEmitRef.current = now;
          }

          rafId = requestAnimationFrame(loop);
        }
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.error("[NoiseSensor] setup error:", err);
      }
    }

    start();

    cleanupRef.current = () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
    };

    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, [active, roomCode, socket]);

  return null; // Invisible component — no UI
}

export default NoiseSensor;
