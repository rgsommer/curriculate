// student-app/src/components/tasks/types/NarrationSynthesizeTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import StepCircle from "../StepCircle";

/**
 * NarrationSynthesizeTask
 * Turn-based oral teach-back / narration task.
 * Enhanced version with animations, visual personality, and immersive feedback.
 *
 * Expected task shape (from backend):
 * task = {
 *   taskType: "narration-synthesize",
 *   title,
 *   prompt,
 *   config: {
 *     playerCount: 2-8,
 *     playerNames: [],
 *     perTurnSeconds: 0|60 (optional),
 *     prompts: [{ id, concept, prompt }], // one per player
 *     ratingScale: { min:1, max:5, label:"Clarity / Accuracy / Quality" }
 *   }
 * }
 */

// Keyframe animations for immersive effects
const createAnimationStyles = () => {
  if (typeof document === "undefined") return {};

  const styleId = "narration-synthesize-animations";
  let style = document.getElementById(styleId);

  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes audioWave {
        0%, 100% { transform: scaleY(0.4); opacity: 0.6; }
        50% { transform: scaleY(1); opacity: 1; }
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes celebrate {
        0% { transform: scale(0) rotate(0deg); opacity: 0; }
        50% { opacity: 1; }
        100% { transform: scale(1) rotate(360deg); opacity: 0; }
      }
      @keyframes timerGlow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
        50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      }
      .audio-bar {
        display: inline-block;
        width: 3px;
        height: 20px;
        margin: 0 2px;
        background: linear-gradient(180deg, #3b82f6, #8b5cf6);
        border-radius: 2px;
        animation: audioWave 0.6s ease-in-out infinite;
      }
      .audio-bar:nth-child(1) { animation-delay: 0s; }
      .audio-bar:nth-child(2) { animation-delay: 0.1s; }
      .audio-bar:nth-child(3) { animation-delay: 0.2s; }
      .audio-bar:nth-child(4) { animation-delay: 0.3s; }
      .audio-bar:nth-child(5) { animation-delay: 0.4s; }
    `;
    document.head.appendChild(style);
  }
};

export default function NarrationSynthesizeTask({
  task,
  onSubmit,
  socket, // unused currently (kept for parity with other tasks)
  roomCode, // unused
  teamId, // unused
}) {
  // Initialize animations
  useEffect(() => {
    createAnimationStyles();
  }, []);
  const config = (task && task.config && typeof task.config === "object") ? task.config : {};
  const playerCount = clampInt(config.playerCount, 1, 8, 4);

  const playerNames = useMemo(() => {
    const namesRaw = Array.isArray(config.playerNames) ? config.playerNames : [];
    if (namesRaw.length >= playerCount) {
      return namesRaw.slice(0, playerCount).map((n, i) => safeName(n, i));
    }
    return Array.from({ length: playerCount }, (_, i) => safeName(namesRaw[i], i));
  }, [config.playerNames, playerCount]);

  const prompts = useMemo(() => {
    const raw = Array.isArray(config.prompts) ? config.prompts : [];
    if (!raw.length) {
      return Array.from({ length: playerCount }, (_, i) => ({
        id: `p${i + 1}`,
        concept: `Concept ${i + 1}`,
        prompt:
          `Explain a key idea from today's lesson in your own words. Include what it is, how it works, and one example.`,
      }));
    }
    return Array.from({ length: playerCount }, (_, i) => {
      const p = raw[i] || raw[i % raw.length] || {};
      const concept = String(p.concept || p.title || `Concept ${i + 1}`).trim().slice(0, 80);
      const prompt = String(p.prompt || p.text || `Explain "${concept}" in your own words.`)
        .trim()
        .slice(0, 420);
      return {
        id: String(p.id || `p${i + 1}`),
        concept,
        prompt,
      };
    });
  }, [config.prompts, playerCount]);

  const ratingScale = useMemo(() => {
    const rs = (config.ratingScale && typeof config.ratingScale === "object") ? config.ratingScale : {};
    const min = clampInt(rs.min, 0, 10, 1);
    const max = clampInt(rs.max, 1, 10, 5);
    return {
      min: Math.min(min, max),
      max: Math.max(min, max),
      label: String(rs.label || "Clarity / Accuracy / Quality").trim().slice(0, 80),
    };
  }, [config.ratingScale]);

  const perTurnSeconds = clampInt(config.perTurnSeconds, 0, 600, 60);

  // Flow state
  const [turnIndex, setTurnIndex] = useState(0); // 0-based
  const [phase, setPhase] = useState("prompt"); // prompt | speaking | rate | done
  const [secondsLeft, setSecondsLeft] = useState(perTurnSeconds);
  const timerRef = useRef(null);

  const [ratings, setRatings] = useState(() =>
    Array.from({ length: playerCount }, () => ({
      value: Math.round((ratingScale.min + ratingScale.max) / 2),
    }))
  );

  const [showCelebration, setShowCelebration] = useState(false);
  const audioRef = useRef(null);

  // Play yay sound
  const playCelebrationSound = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio("/sounds/yay.mp3");
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch (e) {
      // Silently fail if audio unavailable
    }
  };

  // Reset timer when turn changes or perTurnSeconds changes
  useEffect(() => {
    stopTimer();
    setSecondsLeft(perTurnSeconds);
  }, [turnIndex, perTurnSeconds]);

  useEffect(() => {
    return () => stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = prompts[turnIndex] || prompts[0];
  const turnLabel = `Turn ${turnIndex + 1} of ${playerCount}`;
  const currentName = playerNames[turnIndex] || `Player ${turnIndex + 1}`;

  const canUseTimer = perTurnSeconds > 0;

  function startTimer() {
    if (!canUseTimer) return;
    stopTimer();
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        const next = Math.max(0, (Number(s) || 0) - 1);
        if (next <= 0) {
          stopTimer();
          setPhase("rate");
        }
        return next;
      });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function goToSpeaking() {
    setPhase("speaking");
    startTimer();
  }

  function finishSpeaking() {
    stopTimer();
    setPhase("rate");
  }

  function setRatingForTurn(val) {
    // Tester: 'allow .5 gradations'.  Round to 0.5 and clamp.
    const num = Number(val);
    if (!Number.isFinite(num)) return;
    const halfStep = Math.round(num * 2) / 2;
    const v = Math.max(ratingScale.min, Math.min(ratingScale.max, halfStep));
    setRatings((prev) => {
      const next = [...prev];
      next[turnIndex] = { value: v };
      return next;
    });
  }

  function nextTurn() {
    if (turnIndex + 1 >= playerCount) {
      setPhase("done");
      stopTimer();
      setShowCelebration(true);
      playCelebrationSound();
      return;
    }
    setTurnIndex((i) => i + 1);
    setPhase("prompt");
  }

  async function submitAll() {
    const payload = {
      taskType: task?.taskType || "narration-synthesize",
      ratings: ratings.map((r, i) => ({
        playerIndex: i,
        playerName: playerNames[i],
        score: clampInt(r?.value, ratingScale.min, ratingScale.max, ratingScale.min),
      })),
      ratingScale,
      prompts,
      perTurnSeconds,
      completedAt: new Date().toISOString(),
    };

    try {
      await onSubmit(payload);
    } catch (e) {
      try {
        await onSubmit({ answerPayload: payload });
      } catch (_) {}
    }
  }

  // ----- UI helpers with enhanced personality -----

  // Color scheme for phase indicators
  const phaseColors = {
    prompt: { bg: "rgba(219,234,254,0.6)", border: "rgba(59,130,246,0.5)", icon: "📢" },
    speaking: { bg: "rgba(219,239,255,0.6)", border: "rgba(59,130,246,0.7)", icon: "🎤" },
    rate: { bg: "rgba(240,253,250,0.6)", border: "rgba(16,185,129,0.5)", icon: "⭐" },
    done: { bg: "rgba(248,240,245,0.6)", border: "rgba(236,72,153,0.5)", icon: "🎉" },
  };

  const currentPhaseColor = phaseColors[phase] || phaseColors.prompt;

  const cardStyle = {
    borderRadius: 20,
    padding: "20px",
    border: `2px solid ${currentPhaseColor.border}`,
    boxShadow: phase === "speaking"
      ? `0 0 20px rgba(59,130,246,0.25), 0 10px 30px rgba(2,6,23,0.08)`
      : "0 10px 30px rgba(2,6,23,0.08)",
    background: `linear-gradient(135deg, ${currentPhaseColor.bg} 0%, rgba(255,255,255,0.95) 100%)`,
    // Fix per tester feedback: card was shrinking to content width on
    // mobile, leaving a "very narrow backdrop." Force full-width fill
    // with a max-width cap for desktop.
    width: "100%",
    maxWidth: 900,
    boxSizing: "border-box",
    margin: "0 auto",
    transition: "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
    animation: phase === "speaking" ? "pulse 2s ease-in-out infinite" : "none",
  };

  const headerRow = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    marginBottom: 20,
    flexWrap: "wrap",
  };

  const pill = (bg, border = "rgba(148,163,184,0.55)") => ({
    padding: "8px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    border: `1.5px solid ${border}`,
    background: bg,
    color: "#0f172a",
    whiteSpace: "nowrap",
    transition: "all 0.3s ease",
  });

  const bigTitle = {
    fontSize: "clamp(24px, 5vw, 28px)",
    fontWeight: 900,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "#0f172a",
    animation: "slideUp 0.5s ease",
  };

  const subtitle = {
    margin: "8px 0 0 0",
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.4,
  };

  const promptBox = {
    marginTop: 18,
    padding: "18px",
    borderRadius: 16,
    border: `1.5px solid ${currentPhaseColor.border}`,
    background: phase === "speaking"
      ? `linear-gradient(135deg, rgba(219,234,254,0.4), rgba(255,255,255,0.98))`
      : `linear-gradient(135deg, rgba(241,245,249,0.8), rgba(255,255,255,0.95))`,
    animation: "slideUp 0.5s ease",
    transition: "all 0.4s ease",
  };

  const conceptStyle = {
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    color: "#1e293b",
    textTransform: "uppercase",
    margin: "0 0 10px 0",
    opacity: 0.85,
  };

  const promptStyle = {
    fontSize: "clamp(18px, 4vw, 24px)",
    fontWeight: 800,
    color: "#0f172a",
    margin: 0,
    lineHeight: 1.3,
  };

  const hintStyle = {
    fontSize: 13,
    color: "#475569",
    marginTop: 12,
    lineHeight: 1.4,
    fontStyle: "italic",
  };

  const btnBase = {
    borderRadius: 14,
    padding: "13px 16px",
    border: "1px solid rgba(148,163,184,0.7)",
    background: "white",
    color: "#0f172a",
    fontWeight: 900,
    fontSize: 15,
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(2,6,23,0.08)",
    transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
  };

  const btnPrimary = {
    ...btnBase,
    border: "1.5px solid rgba(59,130,246,0.6)",
    background: "linear-gradient(135deg, rgba(59,130,246,0.1), rgba(147,197,253,0.1))",
  };

  const btnPrimaryActive = {
    ...btnPrimary,
    background: "linear-gradient(135deg, rgba(59,130,246,0.25), rgba(147,197,253,0.15))",
    boxShadow: "0 8px 20px rgba(59,130,246,0.25)",
    transform: "scale(1.02)",
  };

  const btnSuccess = {
    ...btnBase,
    border: "1.5px solid rgba(34,197,94,0.6)",
    background: "linear-gradient(135deg, rgba(34,197,94,0.1), rgba(134,239,172,0.1))",
  };

  const btnSuccessActive = {
    ...btnSuccess,
    background: "linear-gradient(135deg, rgba(34,197,94,0.25), rgba(134,239,172,0.15))",
    boxShadow: "0 8px 20px rgba(34,197,94,0.25)",
    transform: "scale(1.02)",
  };

  const btnMuted = {
    ...btnBase,
    opacity: 0.6,
    cursor: "not-allowed",
  };

  const footerRow = {
    display: "flex",
    gap: 12,
    justifyContent: "flex-end",
    marginTop: 18,
    flexWrap: "wrap",
  };

  return (
    <div style={cardStyle}>
      {/* Celebration particles */}
      {showCelebration && (
        <div style={{ position: "absolute", pointerEvents: "none" }}>
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "fixed",
                left: "50%",
                top: "50%",
                fontSize: 32,
                animation: "celebrate 1.5s ease-out forwards",
                animationDelay: `${i * 0.1}s`,
                transform: `rotate(${(i / 8) * 360}deg) translateY(-100px)`,
              }}
            >
              {["🎉", "⭐", "🌟", "✨", "🎊"][i % 5]}
            </div>
          ))}
        </div>
      )}

      <div style={headerRow}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              {currentPhaseColor.icon} NARRATION SYNTHESIZE
            </p>
          </div>
          <h2 style={bigTitle}>{task?.title || "Teach-back Turns"}</h2>
          <p style={subtitle}>
            {task?.prompt ||
              "Take turns explaining out loud. After each turn, the group rates the explanation."}
          </p>

          {/* Enhanced instructions */}
          {phase !== "done" && (
            <div
              style={{
                marginTop: 14,
                borderRadius: 14,
                padding: "12px 14px",
                border: "1.5px solid rgba(203,213,225,0.8)",
                background: "linear-gradient(135deg, rgba(248,250,252,0.9), rgba(241,245,249,0.95))",
                color: "#0f172a",
                fontSize: 13,
                lineHeight: 1.45,
                animation: "slideUp 0.5s ease",
              }}
            >
              <div style={{ fontWeight: 950, marginBottom: 5 }}>⚡ How this works</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={1} /> <b>{currentName}</b> speaks out loud</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={2} /> Everyone listens closely</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={3} /> Group rates it</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}><StepCircle n={4} /> Next player</div>
              </div>
            </div>
          )}
        </div>

        {/* Enhanced phase indicators */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={pill("rgba(224,231,255,0.85)", "rgba(59,130,246,0.5)")}>
            🔢 Turn {turnIndex + 1}/{playerCount}
          </span>
          <span style={pill("rgba(254,243,199,0.85)", "rgba(202,138,4,0.5)")}>
            👤 {currentName}
          </span>
          {canUseTimer ? (
            <span
              style={{
                ...pill("rgba(255,255,255,0.95)", secondsLeft <= 10 ? "rgba(239,68,68,0.7)" : "rgba(107,114,128,0.5)"),
                fontSize: 14,
                fontWeight: 900,
                animation: secondsLeft <= 10 && phase === "speaking" ? "timerGlow 1s ease-in-out infinite" : "none",
                background: secondsLeft <= 10
                  ? "linear-gradient(135deg, rgba(254,226,226,0.9), rgba(255,255,255,0.95))"
                  : "rgba(255,255,255,0.95)",
              }}
            >
              {phase === "speaking" ? "⏱" : "⏲"} {String(secondsLeft).padStart(2, "0")}s
            </span>
          ) : (
            <span style={pill("rgba(241,245,249,0.85)", "rgba(148,163,184,0.5)")}>
              ∞ Unlimited
            </span>
          )}
        </div>
      </div>

      {/* Prompt section with audio wave during speaking */}
      {phase !== "done" && (
        <div style={promptBox}>
          <div style={conceptStyle}>{current?.concept || "Concept"}</div>
          <p style={promptStyle}>{current?.prompt || "Explain the concept out loud."}</p>
          <div style={hintStyle}>
            💡 Speak to your group (not silently). Aim for: what it is • how it works • one example.
          </div>

          {/* Audio wave visualization during speaking */}
          {phase === "speaking" && (
            <div style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 4,
              padding: "12px",
              background: "rgba(59,130,246,0.08)",
              borderRadius: 12,
            }}>
              <span className="audio-bar" />
              <span className="audio-bar" />
              <span className="audio-bar" />
              <span className="audio-bar" />
              <span className="audio-bar" />
            </div>
          )}
        </div>
      )}

      {/* Speaker hand-off banner — large, unmistakable. */}
      {phase === "prompt" && (
        <div
          style={{
            margin: "12px 0 0",
            padding: "14px 16px",
            borderRadius: 14,
            background: "linear-gradient(135deg, rgba(254,243,199,0.85), rgba(255,255,255,0.95))",
            border: "1.5px solid rgba(202,138,4,0.45)",
            textAlign: "center",
            fontWeight: 900,
          }}
        >
          <div style={{ fontSize: 14, color: "#78350f", letterSpacing: 0.2 }}>
            📲 Pass the device to
          </div>
          <div style={{ fontSize: 22, color: "#0f172a", marginTop: 2 }}>
            {currentName}
          </div>
          <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700, marginTop: 2 }}>
            They'll explain the concept out loud.
          </div>
        </div>
      )}

      {/* Start Turn button */}
      {phase === "prompt" && (
        <div style={footerRow}>
          <button
            style={btnPrimaryActive}
            onClick={goToSpeaking}
          >
            🎤 {currentName} — Start Turn
          </button>
        </div>
      )}

      {/* Finished Speaking button with urgency */}
      {phase === "speaking" && (
        <div style={footerRow}>
          <button
            style={btnSuccessActive}
            onClick={finishSpeaking}
          >
            ✓ Finished Speaking
          </button>
        </div>
      )}

      {/* Rating section.  The NEXT player around the table rates the
          one who just spoke — so it's a true peer rating, not self.
          Identify both clearly so it doesn't get muddled. */}
      {phase === "rate" && (() => {
        const raterIdx = (turnIndex + 1) % playerCount;
        const raterName = playerNames[raterIdx] || `Player ${raterIdx + 1}`;
        return (
        <div style={{ marginTop: 18, animation: "slideUp 0.5s ease" }}>
          <div
            style={{
              borderRadius: 16,
              padding: "16px",
              border: "1.5px solid rgba(16,185,129,0.4)",
              background:
                "linear-gradient(135deg, rgba(236,254,250,0.8), rgba(255,255,255,0.95))",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", display: "flex", gap: 6, alignItems: "center" }}>
              ⭐ Peer Rating
            </div>
            <div style={{
              marginTop: 8, fontSize: 13, color: "#334155",
              padding: "8px 10px", borderRadius: 10,
              background: "rgba(124,58,237,0.08)",
              border: "1px solid rgba(124,58,237,0.20)",
            }}>
              📲 Pass the device to <b>{raterName}</b> — they'll rate{" "}
              <b>{currentName}</b>'s explanation on: <b>{ratingScale.label}</b>
            </div>

            <div style={{ marginTop: 14 }}>
              {/* Make the slider role unmistakable: explicit instruction
                  + visible "drag here" arrows.  Allow 0.5 increments. */}
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", textAlign: "center", marginBottom: 6 }}>
                ← drag the slider to rate · {Number(ratings[turnIndex]?.value || ratingScale.min).toFixed(1)}/{ratingScale.max} →
              </div>
              <input
                type="range"
                step="0.5"
                min={ratingScale.min}
                max={ratingScale.max}
                value={Number(ratings[turnIndex]?.value || ratingScale.min)}
                onChange={(e) => setRatingForTurn(e.target.value)}
                style={{
                  width: "100%",
                  height: 8,
                  borderRadius: 4,
                  background: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #84cc16, #22c55e)",
                  outline: "none",
                  WebkitAppearance: "none",
                  cursor: "pointer",
                }}
              />
              <style>{`
                input[type="range"]::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 20px;
                  height: 20px;
                  border-radius: 50%;
                  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                  cursor: pointer;
                  box-shadow: 0 2px 8px rgba(59,130,246,0.4);
                }
                input[type="range"]::-moz-range-thumb {
                  width: 20px;
                  height: 20px;
                  border-radius: 50%;
                  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                  cursor: pointer;
                  border: none;
                  box-shadow: 0 2px 8px rgba(59,130,246,0.4);
                }
              `}</style>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 10,
                  color: "#64748b",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <span>Low</span>
                <span style={{
                  color: "#0f172a",
                  fontSize: 16,
                  fontWeight: 900,
                  padding: "4px 12px",
                  borderRadius: 8,
                  background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(147,197,253,0.1))",
                }}>
                  {clampInt(
                    ratings[turnIndex]?.value,
                    ratingScale.min,
                    ratingScale.max,
                    ratingScale.min
                  )}
                </span>
                <span>High</span>
              </div>
            </div>
          </div>

          <div style={footerRow}>
            <button style={btnPrimaryActive} onClick={nextTurn}>
              {turnIndex + 1 >= playerCount ? "🎉 Finish Task" : "➜ Next Player"}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Completion celebration */}
      {phase === "done" && (
        <div style={{ marginTop: 18, animation: "slideUp 0.5s ease" }}>
          <div
            style={{
              borderRadius: 16,
              padding: "20px",
              border: "1.5px solid rgba(236,72,153,0.4)",
              background:
                "linear-gradient(135deg, rgba(248,240,245,0.9), rgba(255,255,255,0.98))",
            }}
          >
            <div style={{
              fontSize: 20,
              fontWeight: 950,
              color: "#831843",
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 2,
            }}>
              🎉 All Turns Complete!
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#831843", opacity: 0.8 }}>
              Great job! Here's your team's feedback summary.
            </div>

            {/* Summary of ratings */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginBottom: 8, textTransform: "uppercase" }}>
                Ratings Summary
              </div>
              {ratings.map((r, i) => {
                const score = clampInt(r?.value, ratingScale.min, ratingScale.max, ratingScale.min);
                const percent = ((score - ratingScale.min) / (ratingScale.max - ratingScale.min)) * 100;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(236,72,153,0.25)",
                      background: "rgba(255,255,255,0.85)",
                      marginBottom: 8,
                      animation: `slideUp 0.5s ease ${i * 0.1}s backwards`,
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#0f172a", flex: 1 }}>
                      👤 {playerNames[i] || `Player ${i + 1}`}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 100,
                        height: 6,
                        borderRadius: 3,
                        background: "rgba(203,213,225,0.5)",
                        overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${percent}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #84cc16, #22c55e)",
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                      <div style={{
                        fontWeight: 950,
                        color: "#0f172a",
                        fontSize: 14,
                        minWidth: 24,
                        textAlign: "right",
                      }}>
                        {score}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={footerRow}>
              <button style={btnSuccessActive} onClick={submitAll}>
                ✓ Submit Results
              </button>
              <button
                style={btnMuted}
                onClick={() => {
                  setTurnIndex(0);
                  setPhase("prompt");
                  setShowCelebration(false);
                  setRatings(
                    Array.from({ length: playerCount }, () => ({
                      value: Math.round((ratingScale.min + ratingScale.max) / 2),
                    }))
                  );
                  setSecondsLeft(perTurnSeconds);
                }}
              >
                ↻ Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- helpers ----
function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  return Math.max(min, Math.min(max, i));
}

function safeName(v, i) {
  const s = String(v || "").trim();
  if (!s) return `Player ${i + 1}`;
  return s.slice(0, 24);
}
