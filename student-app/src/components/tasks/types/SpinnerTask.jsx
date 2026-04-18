// student-app/src/components/tasks/types/SpinnerTask.jsx
import React, { useState, useRef, useEffect } from "react";

/**
 * Spinner Task — Wheel of Fortune style reward spinner.
 *
 * A colorful wheel with wedges for bonus points, fun rewards, and team perks.
 * Students spin the wheel and get a randomized reward. Pure fun — no wrong answers.
 *
 * config.wedges: array of { label, points?, type: "points"|"bonus"|"perk"|"jackpot" }
 * config.spinPrompt: optional text shown before spinning
 */

const DEFAULT_WEDGES = [
  { label: "+50 pts", points: 50, type: "points" },
  { label: "+100 pts", points: 100, type: "points" },
  { label: "Double Next!", points: 0, type: "bonus" },
  { label: "+200 pts", points: 200, type: "points" },
  { label: "Spin Again!", points: 0, type: "perk" },
  { label: "+150 pts", points: 150, type: "points" },
  { label: "Team High Five!", points: 50, type: "perk" },
  { label: "🎉 JACKPOT +500!", points: 500, type: "jackpot" },
];

const WEDGE_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f43f5e", "#a855f7", "#0ea5e9",
];

export default function SpinnerTask({ task, onSubmit, disabled }) {
  const cfg = task?.config || {};
  const wedges = cfg.wedges?.length ? cfg.wedges : DEFAULT_WEDGES;
  const spinPrompt = cfg.spinPrompt || "Spin the wheel for a reward!";

  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(false);
  const [result, setResult] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [canSpin, setCanSpin] = useState(true);
  const spinCountRef = useRef(0);
  const wheelRef = useRef(null);

  const segmentAngle = 360 / wedges.length;

  function spin() {
    if (spinning || disabled || !canSpin) return;

    setSpinning(true);
    setLanded(false);
    setResult(null);

    // Pick a random wedge
    const winIndex = Math.floor(Math.random() * wedges.length);
    const won = wedges[winIndex];

    // Calculate rotation: multiple full spins + land on the winning wedge
    // Wedge 0 is at the top. We need the pointer (at top) to point at the winning wedge.
    const fullSpins = 5 + Math.floor(Math.random() * 3); // 5-7 full rotations
    const wedgeCenter = winIndex * segmentAngle + segmentAngle / 2;
    // Rotate clockwise; pointer is at top (0°), so we spin to align wedgeCenter to top
    const targetRotation = rotation + fullSpins * 360 + (360 - wedgeCenter);

    setRotation(targetRotation);

    // Wait for spin animation to finish
    setTimeout(() => {
      setSpinning(false);
      setLanded(true);
      setResult(won);
      spinCountRef.current += 1;

      // "Spin Again" perk: allow another spin
      if (won.type === "perk" && won.label.toLowerCase().includes("spin again") && spinCountRef.current < 3) {
        setCanSpin(true);
      } else {
        setCanSpin(false);
      }
    }, 4200); // matches CSS transition duration
  }

  function handleContinue() {
    if (onSubmit) {
      onSubmit({
        answer: result?.label || "spun",
        points: result?.points || 0,
        rewardType: result?.type || "points",
        autoComplete: true,
      });
    }
  }

  return (
    <div style={styles.container}>
      <div style={{ fontSize: "2.5rem" }}>🎰</div>
      <div style={styles.tag}>Spin to Win!</div>

      {!landed && <div style={styles.prompt}>{spinPrompt}</div>}

      {/* ── WHEEL ── */}
      <div style={styles.wheelContainer}>
        {/* Pointer triangle at top */}
        <div style={styles.pointer}>▼</div>

        <div
          ref={wheelRef}
          style={{
            ...styles.wheel,
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)"
              : "none",
          }}
        >
          <svg viewBox="0 0 200 200" width="280" height="280">
            {wedges.map((wedge, i) => {
              const startAngle = i * segmentAngle;
              const endAngle = startAngle + segmentAngle;
              const startRad = (startAngle - 90) * (Math.PI / 180);
              const endRad = (endAngle - 90) * (Math.PI / 180);

              const x1 = 100 + 95 * Math.cos(startRad);
              const y1 = 100 + 95 * Math.sin(startRad);
              const x2 = 100 + 95 * Math.cos(endRad);
              const y2 = 100 + 95 * Math.sin(endRad);

              const largeArc = segmentAngle > 180 ? 1 : 0;

              const pathD = [
                `M 100 100`,
                `L ${x1} ${y1}`,
                `A 95 95 0 ${largeArc} 1 ${x2} ${y2}`,
                `Z`,
              ].join(" ");

              // Text positioning: middle of the wedge arc, pushed out from center
              const textAngle = startAngle + segmentAngle / 2;
              const textRad = (textAngle - 90) * (Math.PI / 180);
              const textR = 62;
              const tx = 100 + textR * Math.cos(textRad);
              const ty = 100 + textR * Math.sin(textRad);

              const color = WEDGE_COLORS[i % WEDGE_COLORS.length];
              const isJackpot = wedge.type === "jackpot";

              return (
                <g key={i}>
                  <path d={pathD} fill={color} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${textAngle}, ${tx}, ${ty})`}
                    fill="#fff"
                    fontSize={isJackpot ? "6" : "7"}
                    fontWeight="800"
                    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                  >
                    {wedge.label}
                  </text>
                </g>
              );
            })}
            {/* Center circle */}
            <circle cx="100" cy="100" r="18" fill="#1e293b" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <text x="100" y="100" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="8" fontWeight="900">
              SPIN
            </text>
          </svg>
        </div>
      </div>

      {/* ── RESULT ── */}
      {landed && result && (
        <div style={{
          animation: "spinReveal 0.5s ease-out",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>
            {result.type === "jackpot" ? "🎉🎉🎉" : result.type === "bonus" ? "⭐" : result.type === "perk" ? "🎊" : "🏆"}
          </div>
          <div style={{
            ...styles.resultBox,
            background: result.type === "jackpot"
              ? "linear-gradient(135deg, rgba(234,179,8,0.2), rgba(245,158,11,0.2))"
              : "rgba(34,197,94,0.12)",
            border: result.type === "jackpot"
              ? "2px solid rgba(234,179,8,0.5)"
              : "1px solid rgba(34,197,94,0.3)",
          }}>
            <div style={{
              fontSize: result.type === "jackpot" ? "1.6rem" : "1.3rem",
              fontWeight: 800,
              color: result.type === "jackpot" ? "#fbbf24" : "#22c55e",
            }}>
              {result.label}
            </div>
            {result.points > 0 && (
              <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: 4 }}>
                +{result.points} bonus points for your team!
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BUTTONS ── */}
      {!landed && (
        <button
          onClick={spin}
          disabled={spinning || disabled}
          style={{
            ...styles.spinBtn,
            opacity: spinning ? 0.6 : 1,
            cursor: spinning ? "wait" : "pointer",
          }}
        >
          {spinning ? "Spinning..." : "🎡 SPIN!"}
        </button>
      )}

      {landed && canSpin && (
        <button
          onClick={() => { setLanded(false); setResult(null); setCanSpin(true); }}
          disabled={disabled}
          style={styles.spinAgainBtn}
        >
          🎡 Spin Again!
        </button>
      )}

      {landed && !canSpin && (
        <button onClick={handleContinue} disabled={disabled} style={styles.continueBtn}>
          Continue →
        </button>
      )}

      <style>{`
        @keyframes spinReveal {
          0% { transform: scale(0.5); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    padding: "24px 16px",
    textAlign: "center",
    gap: 14,
  },
  tag: {
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#fbbf24",
  },
  prompt: {
    fontSize: "1rem",
    color: "#94a3b8",
    fontWeight: 500,
    maxWidth: 320,
  },
  wheelContainer: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "8px 0",
  },
  pointer: {
    position: "absolute",
    top: -8,
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: "1.8rem",
    color: "#fbbf24",
    zIndex: 10,
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))",
    lineHeight: 1,
  },
  wheel: {
    borderRadius: "50%",
    boxShadow: "0 0 0 4px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.4)",
  },
  resultBox: {
    padding: "16px 28px",
    borderRadius: 16,
    textAlign: "center",
  },
  spinBtn: {
    background: "linear-gradient(135deg, #eab308, #f59e0b)",
    border: "none",
    borderRadius: 16,
    padding: "16px 48px",
    color: "#1e293b",
    fontSize: "1.3rem",
    fontWeight: 900,
    boxShadow: "0 6px 24px rgba(234,179,8,0.4)",
    transition: "transform 0.15s ease",
    letterSpacing: 1,
  },
  spinAgainBtn: {
    background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
    border: "none",
    borderRadius: 14,
    padding: "14px 36px",
    color: "#fff",
    fontSize: "1.1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(139,92,246,0.4)",
  },
  continueBtn: {
    marginTop: 4,
    background: "linear-gradient(135deg, #22c55e, #16a34a)",
    border: "none",
    borderRadius: 14,
    padding: "12px 32px",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
  },
};
