// student-app/src/components/tasks/ui/CountdownPresenter.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import SmoothCountdownBar from "./SmoothCountdownBar";

/**
 * CountdownPresenter
 * Standard "1-2-3 GO!" presenter used across tasks.
 *
 * Supports a video-based presenter (preferred) with graceful fallback to numeric countdown.
 *
 * Props (backwards compatible):
 * - title: string
 * - subtext/subtitle: string
 * - seconds: number (for numeric fallback)
 * - countFrom: number (alias for seconds/countdown length)
 * - onDone: function
 * - onCancel: function
 * - resetKey: any (force restart)
 *
 * Video props:
 * - mode: "video" | "numeric"  (default "video")
 * - videoSrc: string (default "/animations/categories/1-2-3-go.mp4")
 * - videoTimeoutMs: number (optional hard timeout safety)
 */
export default function CountdownPresenter({
  title = "Get ready…",
  subtext = "",
  subtitle = "",
  seconds = 3,
  countFrom = null,
  stepMs = 900,
  onDone,
  onCancel,
  autoStart = true,
  showProgressBar = true,
  className = "",
  resetKey = null,

  // video
  mode = "video",
  videoSrc = "/animations/categories/1-2-3-go.mp4",
  videoTimeoutMs = null,
}) {
  const helper = subtext || subtitle || "";
  const numericCountFrom = useMemo(() => {
    const base = typeof countFrom === "number" ? countFrom : seconds;
    const n = Math.max(1, Math.min(10, Number(base) || 3));
    return n;
  }, [countFrom, seconds]);

  const [tick, setTick] = useState(numericCountFrom);
  const [started, setStarted] = useState(autoStart);
  const [done, setDone] = useState(false);

  const videoRef = useRef(null);
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);

  const clearTimers = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const finish = () => {
    if (done) return;
    setDone(true);
    clearTimers();
    try {
      onDone && onDone();
    } catch (_) {}
  };

  // Restart when resetKey changes
  useEffect(() => {
    setDone(false);
    setStarted(autoStart);
    setTick(numericCountFrom);
    clearTimers();

    // Restart video if present
    if (mode === "video") {
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.currentTime = 0;
          if (autoStart) {
            const p = v.play();
            if (p && typeof p.catch === "function") p.catch(() => {});
          }
        } catch (_) {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // VIDEO mode: resolve on ended (preferred), with a timeout safety-net.
  useEffect(() => {
    if (mode !== "video") return;
    if (!started || done) return;

    const v = videoRef.current;
    if (!v) {
      // if video element not ready, fall back to numeric
      return;
    }

    const handleEnded = () => finish();
    v.addEventListener("ended", handleEnded);

    // Hard timeout safety (use metadata duration if available)
    const scheduleTimeout = () => {
      const duration = Number(v.duration);
      const msFromDuration = Number.isFinite(duration) && duration > 0 ? Math.ceil(duration * 1000) : 3200;
      const ms = Math.max(1200, Math.min(10000, Number(videoTimeoutMs) || msFromDuration));
      timeoutRef.current = window.setTimeout(() => finish(), ms);
    };

    try {
      // try play; if browser blocks, we still allow a manual Start button
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}

    // If metadata already loaded, schedule immediately; else wait.
    if (Number.isFinite(Number(v.duration)) && Number(v.duration) > 0) scheduleTimeout();
    else {
      const onMeta = () => scheduleTimeout();
      v.addEventListener("loadedmetadata", onMeta, { once: true });
    }

    return () => {
      v.removeEventListener("ended", handleEnded);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, started, done, videoSrc, numericCountFrom]);

  // NUMERIC mode (fallback)
  useEffect(() => {
    if (mode === "video") return;
    if (!started || done) return;

    setTick(numericCountFrom);
    intervalRef.current = window.setInterval(() => {
      setTick((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
          // brief GO moment, then finish
          timeoutRef.current = window.setTimeout(() => finish(), 450);
          return 0;
        }
        return next;
      });
    }, Math.max(450, Number(stepMs) || 900));

    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, started, done, numericCountFrom, stepMs]);

  const isVideo = mode === "video";

  const cardStyle = {
    borderRadius: 28,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    boxShadow: "0 30px 90px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  };

  return (
    <div className={className} style={{ width: "100%", color: "white" }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 1100, letterSpacing: 0.2, opacity: 0.95 }}>{title}</div>
        {helper ? (
          <div style={{ marginTop: 6, fontSize: 15, fontWeight: 850, opacity: 0.82 }}>{helper}</div>
        ) : null}
      </div>

      <div style={cardStyle}>
        {isVideo ? (
          <div
            style={{
              padding: 14,
              width: "50vw",
              maxWidth: 900,
              minWidth: 280,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div
              style={{
                borderRadius: 22,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.18)",
              }}
            >
              <video
                ref={videoRef}
                src={videoSrc}
                autoPlay={started}
                muted
                playsInline
                loop={false}
                controls={false}
                style={{ width: "100%", height: "auto", display: "block", objectFit: "contain" }}
              />
            </div>

            {showProgressBar ? (
              <div style={{ marginTop: 12 }}>
                {/* video progress is not deterministic across browsers; use a soft bar as a "get ready" feel */}
                <SmoothCountdownBar durationMs={3200} running={started && !done} resetKey={resetKey} />
              </div>
            ) : null}

            {!started ? (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setStarted(true)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.92)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Start
                </button>
                {onCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel && onCancel()}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.92)",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ padding: 18 }}>
            <div
              style={{
                display: "grid",
                placeItems: "center",
                padding: 10,
                borderRadius: 22,
                background: "rgba(0,0,0,0.18)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <div style={{ fontSize: 82, fontWeight: 1200, lineHeight: 1, textShadow: "0 16px 50px rgba(0,0,0,0.45)" }}>
                {tick <= 0 ? "GO!" : tick}
              </div>
              {showProgressBar ? (
                <div style={{ width: "100%", marginTop: 14 }}>
                  <SmoothCountdownBar durationMs={numericCountFrom * Math.max(450, Number(stepMs) || 900)} running={started && !done} resetKey={resetKey} />
                </div>
              ) : null}
            </div>

            {!started ? (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setStarted(true)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.92)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Start
                </button>
                {onCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel && onCancel()}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.92)",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
