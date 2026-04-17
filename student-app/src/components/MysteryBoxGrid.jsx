// student-app/src/components/MysteryBoxGrid.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";

/**
 * Mystery Box Grid — Self-directed task navigation.
 *
 * Shows a grid of "gift boxes" representing the tasks in the set.
 * Each box is shuffled per team so layouts differ. Boxes show:
 *   - Star rating (1-3) hinting at point value
 *   - A subtle inter-team badge if applicable
 *   - State: locked / available / active / completed
 *
 * Tapping an available box emits mystery:openBox → backend sends task:assigned.
 * After completing a task, the grid re-appears with that box marked done.
 */

// ── Box color palette (cycles through for visual variety) ──
const BOX_COLORS = [
  { bg: "linear-gradient(135deg, #f472b6, #ec4899)", shadow: "rgba(236,72,153,0.4)" },
  { bg: "linear-gradient(135deg, #60a5fa, #3b82f6)", shadow: "rgba(59,130,246,0.4)" },
  { bg: "linear-gradient(135deg, #34d399, #10b981)", shadow: "rgba(16,185,129,0.4)" },
  { bg: "linear-gradient(135deg, #fbbf24, #f59e0b)", shadow: "rgba(245,158,11,0.4)" },
  { bg: "linear-gradient(135deg, #a78bfa, #8b5cf6)", shadow: "rgba(139,92,246,0.4)" },
  { bg: "linear-gradient(135deg, #f87171, #ef4444)", shadow: "rgba(239,68,68,0.4)" },
  { bg: "linear-gradient(135deg, #2dd4bf, #14b8a6)", shadow: "rgba(20,184,166,0.4)" },
  { bg: "linear-gradient(135deg, #fb923c, #f97316)", shadow: "rgba(249,115,22,0.4)" },
];

const COMPLETED_BG = "linear-gradient(135deg, #d1d5db, #9ca3af)";

function StarRating({ tier }) {
  const stars = Math.max(1, Math.min(3, tier || 1));
  return (
    <div style={{ fontSize: "1rem", letterSpacing: 2, marginTop: 4 }}>
      {"★".repeat(stars)}{"☆".repeat(3 - stars)}
    </div>
  );
}

function CountdownTimer({ endTime }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, (endTime || 0) - Date.now()));

  useEffect(() => {
    if (!endTime) return;
    const iv = setInterval(() => {
      const r = Math.max(0, endTime - Date.now());
      setRemaining(r);
      if (r <= 0) clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [endTime]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const urgent = remaining < 60000;

  return (
    <div style={{
      fontSize: "1.1rem",
      fontWeight: 800,
      color: urgent ? "#ef4444" : "#f9fafb",
      fontVariantNumeric: "tabular-nums",
      animation: urgent ? "timerPulse 1s ease-in-out infinite" : undefined,
    }}>
      {mins}:{secs.toString().padStart(2, "0")}
    </div>
  );
}

export default function MysteryBoxGrid({
  grid,         // { boxes, activeBox, completedCount, totalBoxes, globalTimerEnd, globalTimerMs, challengeQueued }
  onOpenBox,    // (boxPos) => void
  challengeBeacon, // { challengeId, taskType, taskTitle, pointBonus, expiresAt } | null
  onAcceptChallenge, // (challengeId) => void
  teamName,
}) {
  const [openingBox, setOpeningBox] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);

  if (!grid || !grid.boxes) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#f9fafb" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>Loading mystery boxes...</div>
      </div>
    );
  }

  const { boxes, completedCount, totalBoxes, globalTimerEnd } = grid;
  const progressPct = totalBoxes > 0 ? Math.round((completedCount / totalBoxes) * 100) : 0;

  // Grid columns: adapt to count
  const cols = boxes.length <= 4 ? 2 : boxes.length <= 9 ? 3 : 4;

  const handleBoxTap = (boxPos) => {
    const box = boxes[boxPos];
    if (!box || box.completed || box.active || openingBox !== null) return;

    setOpeningBox(boxPos);
    // Brief animation delay before actually opening
    setTimeout(() => {
      onOpenBox(boxPos);
      setOpeningBox(null);
    }, 400);
  };

  return (
    <div style={{
      padding: "12px 8px",
      maxWidth: 480,
      margin: "0 auto",
    }}>
      {/* Keyframes */}
      <style>{`
        @keyframes boxBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes boxShake {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-3deg); }
          75% { transform: rotate(3deg); }
        }
        @keyframes boxOpen {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2) rotate(5deg); opacity: 0.8; }
          100% { transform: scale(0.8); opacity: 0.5; }
        }
        @keyframes beaconPulse {
          0%, 100% { box-shadow: 0 0 8px rgba(251,191,36,0.6); }
          50% { box-shadow: 0 0 20px rgba(251,191,36,0.9); }
        }
        @keyframes timerPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Header: progress + timer */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
        padding: "8px 12px",
        background: "rgba(15,23,42,0.5)",
        borderRadius: 12,
        backdropFilter: "blur(8px)",
      }}>
        <div>
          <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>BOXES OPENED</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f9fafb" }}>
            {completedCount} / {totalBoxes}
          </div>
        </div>
        <div style={{
          width: "35%",
          height: 6,
          background: "rgba(255,255,255,0.15)",
          borderRadius: 3,
          overflow: "hidden",
        }}>
          <div style={{
            width: `${progressPct}%`,
            height: "100%",
            background: progressPct === 100 ? "#22c55e" : "#8b5cf6",
            borderRadius: 3,
            transition: "width 0.4s ease",
          }} />
        </div>
        {globalTimerEnd && <CountdownTimer endTime={globalTimerEnd} />}
      </div>

      {/* Challenge beacon overlay */}
      {challengeBeacon && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
            borderRadius: 12,
            textAlign: "center",
            animation: "beaconPulse 1.5s ease-in-out infinite",
            cursor: "pointer",
          }}
          onClick={() => onAcceptChallenge?.(challengeBeacon.challengeId)}
        >
          <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#78350f" }}>
            Challenge Available!
          </div>
          <div style={{ fontSize: "0.78rem", color: "#92400e", marginTop: 2 }}>
            {challengeBeacon.taskTitle || "A team wants to battle!"} — Tap to accept for {challengeBeacon.pointBonus} bonus!
          </div>
        </div>
      )}

      {/* Box grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 10,
      }}>
        {boxes.map((box, i) => {
          const color = BOX_COLORS[i % BOX_COLORS.length];
          const isCompleted = box.completed;
          const isActive = box.active;
          const isOpening = openingBox === box.boxPos;
          const isAvailable = !isCompleted && !isActive && openingBox === null;

          return (
            <div
              key={box.boxPos}
              onClick={() => isAvailable && handleBoxTap(box.boxPos)}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: 14,
                background: isCompleted ? COMPLETED_BG : color.bg,
                boxShadow: isCompleted
                  ? "none"
                  : `0 4px 16px ${color.shadow}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: isAvailable ? "pointer" : "default",
                opacity: isCompleted ? 0.6 : 1,
                transform: isOpening ? "scale(1.15) rotate(5deg)" : "scale(1)",
                transition: "transform 0.3s ease, opacity 0.3s ease",
                animation: isAvailable && !isCompleted ? "boxBounce 3s ease-in-out infinite" : undefined,
                animationDelay: `${i * 0.15}s`,
                overflow: "hidden",
                userSelect: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {/* Completed overlay */}
              {isCompleted && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 14,
                }}>
                  <div style={{ fontSize: "2.4rem" }}>✓</div>
                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "#f9fafb" }}>
                    +{box.pointsEarned}
                  </div>
                </div>
              )}

              {/* Active indicator */}
              {isActive && (
                <div style={{
                  position: "absolute", inset: 0,
                  border: "3px solid #fff",
                  borderRadius: 14,
                  animation: "boxShake 0.5s ease-in-out infinite",
                }} />
              )}

              {/* Box content (when not completed) */}
              {!isCompleted && (
                <>
                  <div style={{ fontSize: "3.2rem", lineHeight: 1 }}>
                    {isOpening ? "💫" : "🎁"}
                  </div>
                  <StarRating tier={box.starTier} />
                  {box.isInterTeam && (
                    <div
                      title="Challenge box! Open to challenge another team for 1.5× bonus points"
                      style={{
                        position: "absolute",
                        top: 4, right: 4,
                        fontSize: "0.65rem",
                        background: "linear-gradient(135deg, rgba(251,191,36,0.9), rgba(245,158,11,0.9))",
                        borderRadius: 8,
                        padding: "2px 6px",
                        color: "#fff",
                        fontWeight: 800,
                        textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                        boxShadow: "0 2px 6px rgba(251,191,36,0.4)",
                        letterSpacing: "0.05em",
                      }}>
                      ⚔️ VS
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Queued challenge info */}
      {grid.challengeQueued && (
        <div style={{
          marginTop: 10,
          padding: "8px 12px",
          background: "rgba(139,92,246,0.2)",
          borderRadius: 10,
          border: "1px solid rgba(139,92,246,0.4)",
          fontSize: "0.78rem",
          color: "#c4b5fd",
          textAlign: "center",
        }}>
          Challenge queued — will start after your current task!
        </div>
      )}
    </div>
  );
}
