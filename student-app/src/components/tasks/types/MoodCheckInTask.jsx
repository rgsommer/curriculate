// student-app/src/components/tasks/types/MoodCheckInTask.jsx
import React, { useEffect, useMemo, useState } from "react";

const MOODS = [
  { emoji: "😄", label: "Super excited!" },
  { emoji: "🙂", label: "Feeling good" },
  { emoji: "😐", label: "Okay" },
  { emoji: "😴", label: "A bit tired" },
  { emoji: "😔", label: "Not great" },
];

// Lightweight CSS confetti (no dependencies)
function ConfettiBurst({ show, onDone }) {
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => onDone?.(), 1600);
    return () => clearTimeout(t);
  }, [show, onDone]);

  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => i), []);

  if (!show) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 9999,
      }}
    >
      <style>{`
        @keyframes mc-pop {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
      `}</style>

      {pieces.map((i) => {
        const left = (i * 97) % 100;
        const delay = (i % 8) * 0.03;
        const size = 6 + ((i * 11) % 10);
        const duration = 1.0 + ((i * 13) % 9) / 10;

        const colors = ["#22c55e", "#3b82f6", "#f97316", "#e879f9", "#facc15", "#ef4444"];
        const bg = colors[i % colors.length];

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: "-24px",
              left: `${left}%`,
              width: size,
              height: size * 1.6,
              background: bg,
              borderRadius: 3,
              animation: `mc-pop ${duration}s ease-in ${delay}s forwards`,
              transform: `rotate(${(i * 27) % 360}deg)`,
              boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
            }}
          />
        );
      })}
    </div>
  );
}

export default function MoodCheckInTask({
  task,
  onSubmit,
  disabled = false,
  memberNames = [],
}) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  // Prefer memberNames length (team reality), but allow explicit overrides
  const explicitCount =
    cfg.playerCount ?? task?.playerCount ?? cfg.players ?? task?.players ?? null;

  // Normalize: members may be strings or {name, email} objects
  const nameOf = (m) => (typeof m === "object" && m !== null ? m.name || "" : String(m || ""));

  const inferredFromNames = Array.isArray(memberNames)
    ? memberNames.filter((n) => nameOf(n).trim().length > 0).length
    : 0;

  const playerCountRaw =
    explicitCount != null ? Number(explicitCount) : inferredFromNames || 1;

  const playerCount = Math.max(1, Math.min(8, Number(playerCountRaw) || 1));

  // Default ON, but teacher/task can turn it off
  const excitementEnabled = cfg.sharedExcitementEnabled !== false;

  const [moods, setMoods] = useState(() => Array(playerCount).fill(null)); // mood index 0..4
  const [excitement, setExcitement] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Keep moods array aligned if playerCount changes
  useEffect(() => {
    setMoods((prev) => {
      const next = Array(playerCount).fill(null);
      for (let i = 0; i < Math.min(prev.length, next.length); i++) next[i] = prev[i];
      return next;
    });
  }, [playerCount]);

  const allSelected = moods.every((m) => m !== null);

  const getDisplayName = (idx) => {
    const raw = nameOf(memberNames?.[idx]).trim();
    return raw || `Player ${idx + 1}`;
  };

  const handleMood = (idx, moodIndex) => {
    if (disabled || submitted) return;
    setMoods((prev) => {
      const next = [...prev];
      next[idx] = moodIndex;
      return next;
    });
  };

  const handleSubmit = () => {
    if (disabled || submitted) return;
    if (!allSelected) return;

    setSubmitted(true);
    setShowConfetti(true);

    // Keep payload simple; StudentApp can wrap with type if it wants
    onSubmit?.({
      moods, // indices 0..4
      excitement: excitementEnabled ? excitement.trim() : "",
      playerCount,
      moodLabels: moods.map((idx) => MOODS[idx]?.label || null),
      moodEmojis: moods.map((idx) => MOODS[idx]?.emoji || null),
    });
  };

  return (
    <div
      style={{
        padding: 22,
        textAlign: "center",
        minHeight: "78vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 20% 10%, rgba(255,255,255,0.35), transparent 40%)," +
          "linear-gradient(135deg, #60a5fa, #f59e0b)",
        color: "#0f172a",
        borderRadius: 18,
      }}
    >
      <ConfettiBurst show={showConfetti} onDone={() => setShowConfetti(false)} />

      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <h2 style={{ fontSize: "2.1rem", marginBottom: 8, fontWeight: 900 }}>
          Mood Check-In
        </h2>

        <div
          style={{
            fontSize: "1.05rem",
            marginBottom: 22,
            fontWeight: 600,
            opacity: 0.92,
          }}
        >
          Tap an emoji for each player — then let's start strong.
        </div>

        {Array.from({ length: playerCount }, (_, i) => (
          <div
            key={i}
            style={{
              margin: "14px auto",
              padding: 14,
              borderRadius: 18,
              background: "rgba(255,255,255,0.28)",
              border: "1px solid rgba(255,255,255,0.35)",
              boxShadow: "0 10px 26px rgba(0,0,0,0.10)",
            }}
          >
            <div style={{ fontSize: "1.15rem", fontWeight: 900, marginBottom: 10 }}>
              {getDisplayName(i)}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 10,
                alignItems: "stretch",
              }}
            >
              {MOODS.map((mood, idx) => {
                const selected = moods[i] === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => handleMood(i, idx)}
                    disabled={disabled || submitted}
                    type="button"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "12px 8px",
                      borderRadius: 18,
                      border: selected ? "3px solid #0f172a" : "1px solid rgba(15,23,42,0.12)",
                      background: selected ? "#ffffff" : "rgba(255,255,255,0.55)",
                      cursor: disabled || submitted ? "not-allowed" : "pointer",
                      transform: selected ? "translateY(-2px)" : "translateY(0)",
                      transition: "transform 120ms ease, background 120ms ease, border 120ms ease",
                      boxShadow: selected ? "0 10px 18px rgba(0,0,0,0.14)" : "none",
                    }}
                    aria-pressed={selected}
                    title={mood.label}
                  >
                    <div style={{ fontSize: "3rem", lineHeight: 1 }}>{mood.emoji}</div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 800, marginTop: 6 }}>
                      {mood.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {excitementEnabled && (
          <div
            style={{
              margin: "18px auto 8px",
              padding: 16,
              borderRadius: 18,
              background: "rgba(255,255,255,0.28)",
              border: "1px solid rgba(255,255,255,0.35)",
              boxShadow: "0 10px 26px rgba(0,0,0,0.10)",
              maxWidth: 860,
            }}
          >
            <label
              style={{
                fontSize: "1.05rem",
                display: "block",
                marginBottom: 10,
                fontWeight: 900,
              }}
            >
              What are you excited about today?{" "}
              <span style={{ fontWeight: 700, opacity: 0.85 }}>(optional)</span>
            </label>

            <textarea
              placeholder="Optional team shout-out!"
              value={excitement}
              onChange={(e) => setExcitement(e.target.value)}
              rows={3}
              disabled={disabled || submitted}
              style={{
                width: "100%",
                maxWidth: 820,
                padding: 14,
                fontSize: "1rem",
                borderRadius: 14,
                border: "1px solid rgba(15,23,42,0.18)",
                background: "#ffffff",
                color: "#0f172a",
                resize: "vertical",
              }}
            />
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button
            onClick={handleSubmit}
            disabled={!allSelected || disabled || submitted}
            type="button"
            style={{
              padding: "16px 46px",
              fontSize: "1.25rem",
              fontWeight: 900,
              background: allSelected && !disabled && !submitted ? "#22c55e" : "#94a3b8",
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              cursor: allSelected && !disabled && !submitted ? "pointer" : "not-allowed",
              opacity: allSelected && !disabled && !submitted ? 1 : 0.75,
              boxShadow: allSelected && !disabled && !submitted ? "0 12px 26px rgba(34,197,94,0.35)" : "none",
              letterSpacing: "0.3px",
            }}
          >
            Let's Curriculate!
          </button>

          {!allSelected && (
            <div style={{ marginTop: 10, fontSize: "0.95rem", fontWeight: 700, opacity: 0.9 }}>
              Select a mood for every player to continue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
