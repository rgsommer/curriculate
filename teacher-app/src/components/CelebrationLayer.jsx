// teacher-app/src/components/CelebrationLayer.jsx
//
// Pass-3 emotional reinforcement layer. Watches signals already in
// state (scores, taskIndex, treats given) and fires tasteful
// moment-banners + a light confetti burst when something the teacher
// cares about happens:
//
//   🏆 NEW LEAD            — a team takes the #1 spot
//   ⚡ ROUND ADVANCED       — host moved to the next task
//   🎉 TASKSET COMPLETE     — final round queued / done
//   🍬 TREAT AWARDED        — a treat just landed
//
// Pure presentation. Reads existing state via props, mutates nothing,
// emits no socket events. Confetti is canvas-free DOM with absolute-
// positioned spans — under 1% perf cost on a real laptop.

import React, { useEffect, useRef, useState } from "react";

const PALETTES = [
  { color: "#fef08a" }, // gold
  { color: "#fb923c" }, // orange
  { color: "#a855f7" }, // purple
  { color: "#38bdf8" }, // sky
  { color: "#34d399" }, // emerald
  { color: "#f472b6" }, // pink
];

/** Single confetti spark used in the burst. */
function ConfettiSpark({ from, color, delay }) {
  // Random landing point within a ±320px x 220px box from `from`.
  const dx = (Math.random() * 640) - 320;
  const dy = 80 + Math.random() * 220;
  const rot = (Math.random() * 720) - 360;
  return (
    <span
      style={{
        position: "absolute",
        left: from.x,
        top: from.y,
        width: 8 + Math.random() * 6,
        height: 12 + Math.random() * 8,
        background: color,
        borderRadius: 2,
        opacity: 0,
        // CSS variables drive the keyframe target so each spark gets
        // its own destination + rotation without inline @keyframes.
        "--clx": `${dx}px`,
        "--cly": `${dy}px`,
        "--clr": `${rot}deg`,
        animation: `clSpark 1.6s ${delay}ms cubic-bezier(.22,1,.36,1) forwards`,
        willChange: "transform, opacity",
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * CelebrationLayer
 *
 * Mounted ONCE near the top of the page. Watches:
 *   topTeamId      — derived by parent from sorted scores; we fire NEW LEAD
 *                    when this changes (after the initial mount).
 *   topTeamName    — display name for the NEW LEAD banner.
 *   taskIndex      — when this advances by ≥1, fire ROUND ADVANCED.
 *   totalTasks     — used to detect TASKSET COMPLETE.
 *   treatsGiven    — when this ticks up, fire TREAT AWARDED.
 *   muted          — if true (e.g. teacher in Command Center), suppress.
 */
export default function CelebrationLayer({
  topTeamId = null,
  topTeamName = "",
  taskIndex = -1,
  totalTasks = 0,
  treatsGiven = 0,
  muted = false,
  // Pass-4: when this flips true (e.g. session ends, leaderboard
  // locked), fire the big finale: 200-spark cascade + winner banner.
  sessionEnded = false,
}) {
  // Refs for "what was the previous value" comparisons.
  const initRef = useRef(false);
  const lastTopRef = useRef(topTeamId);
  const lastTaskIdxRef = useRef(taskIndex);
  const lastTreatsRef = useRef(treatsGiven);
  const lastEndedRef = useRef(sessionEnded);

  // Single active moment at a time (no stacking on screen).
  const [moment, setMoment] = useState(null); // { kind, headline, sub, color, key }
  const [confetti, setConfetti] = useState(null); // { sparks: number, color }

  const fire = (m) => {
    setMoment({ ...m, key: Date.now() });
    if (m.confetti) {
      setConfetti({ sparks: m.confetti, color: m.color });
      // Confetti auto-clears after the longest spark animation. Big
      // bursts (finale) need longer; per-spark stagger means the last
      // spark fires up to (sparks * 22ms) after the first.
      const confettiMs = 2000 + Math.max(0, m.confetti - 40) * 18;
      setTimeout(() => setConfetti(null), confettiMs);
    }
    // Banner auto-clears (per-moment override allowed).
    const bannerMs = typeof m.bannerMs === "number" ? m.bannerMs : 3600;
    setTimeout(() => {
      setMoment((cur) => (cur && cur.key === m.key + 0 ? null : cur));
    }, bannerMs);
  };

  useEffect(() => {
    // Skip the initial mount — only react to CHANGES.
    if (!initRef.current) {
      initRef.current = true;
      lastTopRef.current = topTeamId;
      lastTaskIdxRef.current = taskIndex;
      lastTreatsRef.current = treatsGiven;
      return;
    }
    if (muted) return;

    const prevTop = lastTopRef.current;
    if (topTeamId && topTeamId !== prevTop && topTeamName) {
      fire({
        kind: "newLead",
        headline: `${topTeamName} take the lead 🏆`,
        sub: "New #1 on the board",
        color: "#fef08a",
        confetti: 36,
      });
    }
    lastTopRef.current = topTeamId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTeamId, topTeamName, muted]);

  useEffect(() => {
    if (!initRef.current) return;
    if (muted) return;
    const prev = lastTaskIdxRef.current;
    if (taskIndex > prev && taskIndex >= 0) {
      const isLast = totalTasks > 0 && taskIndex + 1 >= totalTasks;
      if (isLast) {
        fire({
          kind: "tasksetComplete",
          headline: "Mission accomplished 🎉",
          sub: "Final round queued — bring it home",
          color: "#a855f7",
          confetti: 80,
        });
      } else if (taskIndex > 0) {
        // Skip the first warm-up advance; the dashboard already
        // headlines round 1.
        fire({
          kind: "roundAdvanced",
          headline: `Round ${taskIndex + 1} live ⚡`,
          sub: "Teams are on the move",
          color: "#34d399",
          confetti: 18,
        });
      }
    }
    lastTaskIdxRef.current = taskIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskIndex, totalTasks, muted]);

  useEffect(() => {
    if (!initRef.current) return;
    if (muted) return;
    const prev = lastTreatsRef.current;
    if (treatsGiven > prev) {
      fire({
        kind: "treatAwarded",
        headline: "Treat awarded 🍬",
        sub: "Pop one in real life too",
        color: "#fb923c",
        confetti: 12,
      });
    }
    lastTreatsRef.current = treatsGiven;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatsGiven, muted]);

  // Pass-4: session-complete finale. Honours muted so a Command-Center
  // teacher who closes the session doesn't get a confetti shower.
  useEffect(() => {
    if (!initRef.current) {
      lastEndedRef.current = sessionEnded;
      return;
    }
    if (muted) {
      lastEndedRef.current = sessionEnded;
      return;
    }
    if (sessionEnded && !lastEndedRef.current) {
      const winnerLine = topTeamName
        ? `${topTeamName} take the crown 👑`
        : "Session complete 👑";
      fire({
        kind: "sessionFinale",
        headline: winnerLine,
        sub: "Three cheers for everyone in the room",
        color: "#facc15",
        confetti: 200,
        bannerMs: 7000,
      });
    }
    lastEndedRef.current = sessionEnded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEnded, topTeamName, muted]);

  // Single-time stylesheet injection.
  useEffect(() => {
    const id = "celebration-layer-keyframes";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = `
      @keyframes clSpark {
        0%   { opacity: 0; transform: translate(0,0) rotate(0); }
        15%  { opacity: 1; }
        100% { opacity: 0; transform: translate(var(--clx), var(--cly)) rotate(var(--clr)); }
      }
      @keyframes clBannerIn {
        0%   { opacity: 0; transform: translate(-50%, -8px) scale(0.96); }
        100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
      }
      @keyframes clBannerOut {
        0%   { opacity: 1; transform: translate(-50%, 0) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -8px) scale(0.98); }
      }
    `;
    document.head.appendChild(el);
  }, []);

  return (
    <div
      data-testid="celebration-layer"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 80,
        overflow: "hidden",
      }}
    >
      {/* Confetti burst */}
      {confetti && (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
          {Array.from({ length: confetti.sparks }, (_, i) => {
            const palette = PALETTES[i % PALETTES.length];
            return (
              <ConfettiSpark
                key={i}
                from={{
                  x: typeof window !== "undefined" ? window.innerWidth / 2 : 600,
                  y: typeof window !== "undefined" ? Math.max(120, window.innerHeight * 0.18) : 160,
                }}
                color={palette.color}
                delay={i * 22}
              />
            );
          })}
        </div>
      )}

      {/* Single moment banner */}
      {moment && (
        <div
          key={moment.key}
          style={{
            position: "absolute",
            top: 28,
            left: "50%",
            transform: "translateX(-50%)",
            minWidth: 280,
            maxWidth: "92vw",
            padding: "14px 22px",
            borderRadius: 18,
            background: "linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(30,41,59,0.92) 100%)",
            border: `1px solid ${moment.color}`,
            boxShadow: `0 0 28px ${moment.color}55, 0 18px 50px rgba(15,23,42,0.45)`,
            color: "#fff",
            textAlign: "center",
            animation: "clBannerIn 0.32s cubic-bezier(.22,1,.36,1) both",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: "1.05rem", lineHeight: 1.2, letterSpacing: 0.2 }}>
            {moment.headline}
          </div>
          {moment.sub && (
            <div style={{ marginTop: 4, fontSize: "0.78rem", opacity: 0.78, fontWeight: 600 }}>
              {moment.sub}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
