// teacher-app/src/components/StreakBanner.jsx
//
// Pass-2 hot-streak banner for the Live Session redesign. Renders
// across the bottom of the page when a team has a notable streak —
// a sweep of consecutive correct answers, fastest finish, comeback,
// etc. Calmly dramatic — a single line of bold copy + a subtle ember
// glow + an action chip on the right.
//
// Pure presentation. The parent computes the streak (if any) from
// the existing submissions stream and passes it in. When `streak` is
// null/undefined the banner renders nothing.

import React from "react";

const STREAK_FLAVOR = {
  correctStreak: { emoji: "🔥", verb: "ARE ON", suffix: "STREAK", glow: "rgba(251,146,60,0.55)", color: "#fed7aa" },
  speed:         { emoji: "⚡", verb: "ARE THE",   suffix: "FASTEST",  glow: "rgba(56,189,248,0.55)", color: "#bae6fd" },
  comeback:      { emoji: "⭐", verb: "PULLED OFF", suffix: "COMEBACK", glow: "rgba(168,85,247,0.55)", color: "#e9d5ff" },
  lead:          { emoji: "🏆", verb: "JUST TOOK",  suffix: "LEAD",     glow: "rgba(254,240,138,0.55)", color: "#fef08a" },
  accuracy:      { emoji: "🎯", verb: "HOLD THE",   suffix: "ACCURACY", glow: "rgba(134,239,172,0.55)", color: "#bbf7d0" },
};

/**
 * StreakBanner
 *
 * streak  — { kind, teamName, value, label? } | null
 *           kind ∈ correctStreak | speed | comeback | lead | accuracy
 *           value: number or label depending on kind
 *           e.g. { kind: "correctStreak", teamName: "Red Raptors", value: 4 }
 *           or   { kind: "lead", teamName: "Blue Pharaohs" }
 * onAward — optional callback. When provided, shows a tasteful
 *           "Award Bonus" chip on the right.
 */
export default function StreakBanner({ streak, onAward }) {
  if (!streak || !streak.teamName) return null;
  const flavor = STREAK_FLAVOR[streak.kind] || STREAK_FLAVOR.correctStreak;

  const valueText = (() => {
    if (streak.label) return streak.label;
    if (streak.kind === "correctStreak" && typeof streak.value === "number") {
      return `${streak.value}-CORRECT`;
    }
    if (streak.kind === "speed" && streak.value) {
      return String(streak.value).toUpperCase();
    }
    return "";
  })();

  const teamName = String(streak.teamName).toUpperCase();
  const headline = `${teamName} ${flavor.verb} ${valueText ? `${valueText} ` : ""}${flavor.suffix}!`;

  return (
    <div
      data-testid="streak-banner"
      style={{
        position: "relative",
        marginTop: 14,
        padding: "16px 22px",
        borderRadius: 18,
        background:
          "linear-gradient(90deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.85) 50%, rgba(15,23,42,0.95) 100%)",
        border: `1px solid ${flavor.glow}`,
        boxShadow: `0 0 24px ${flavor.glow}, 0 16px 36px rgba(15,23,42,0.32)`,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 14,
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes sbEmber { 0%,100% { transform: translateX(-100%); opacity: 0.0 } 50% { opacity: 0.55 } }
        @keyframes sbPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.10) } }
      `}</style>

      {/* Sweeping ember glow behind the text */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "50%",
          height: "100%",
          background: `linear-gradient(90deg, transparent, ${flavor.glow}, transparent)`,
          animation: "sbEmber 4.5s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      <div
        aria-hidden="true"
        style={{
          fontSize: "1.8rem",
          animation: "sbPulse 1.4s ease-in-out infinite",
          filter: `drop-shadow(0 0 8px ${flavor.glow})`,
          flexShrink: 0,
        }}
      >
        {flavor.emoji}
      </div>

      <div
        style={{
          position: "relative",
          flex: 1,
          fontSize: "1.05rem",
          fontWeight: 900,
          letterSpacing: 0.4,
          color: flavor.color,
          textTransform: "uppercase",
          textShadow: `0 1px 0 rgba(0,0,0,0.45)`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {headline}
      </div>

      {onAward && (
        <button
          type="button"
          onClick={onAward}
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.10)",
            border: `1px solid ${flavor.color}`,
            color: flavor.color,
            fontWeight: 900,
            fontSize: "0.82rem",
            letterSpacing: 0.4,
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "transform 0.16s ease-out, background 0.16s ease-out",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.background = "rgba(255,255,255,0.16)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
        >
          <span aria-hidden="true">⭐</span>
          Award Bonus
        </button>
      )}
    </div>
  );
}
