// teacher-app/src/components/GMQuickControls.jsx
//
// Pass-4. Slim toolbar of chip-style controls for Game Master Mode.
// In Command Center the full controls panel is still available;
// here we surface only the five live-action levers the teacher
// reaches for mid-session:
//
//   ▶ Next Round   — advance to the next task
//   ⏸ Pause / ▶ Resume — toggle a local "Hold the Spotlight" flag
//   👁 Reveal Answer — flips the teacher's reveal flag
//   🍬 Treat — give the room a treat (uses existing handler)
//   🏁 End Session — finish + email report (uses existing handler)
//
// Each chip is theme-tinted (accent + glow from the active theme)
// and disables when the relevant action isn't currently valid.
//
// Pause/Reveal are LOCAL flags the parent can wire through to whatever
// downstream surface needs them — they're presentation hints, not
// authoritative state. Passing onPauseToggle / onRevealToggle is
// optional: when omitted those chips disable.

import React from "react";
import { getTheme } from "./themes";

export default function GMQuickControls({
  themeId = "neon-night",
  onNextRound,
  onPauseToggle,
  paused = false,
  onRevealToggle,
  revealed = false,
  onTreat,
  treatAvailable = true,
  onEndSession,
  isEndingSession = false,
  isActive = false,
}) {
  const theme = getTheme(themeId);

  const chips = [
    {
      id: "next",
      label: "Next Round",
      icon: "⏭",
      onClick: onNextRound,
      disabled: !onNextRound || !isActive,
      tone: theme.accentSecondary,
    },
    {
      id: "pause",
      label: paused ? "Resume" : "Pause Timer",
      icon: paused ? "▶" : "⏸",
      onClick: onPauseToggle,
      disabled: !onPauseToggle,
      tone: paused ? "#34d399" : "#fb923c",
      active: paused,
    },
    {
      id: "reveal",
      label: revealed ? "Hide Answer" : "Reveal Answer",
      icon: "👁",
      onClick: onRevealToggle,
      disabled: !onRevealToggle,
      tone: "#fef08a",
      active: revealed,
    },
    {
      id: "treat",
      label: "Award Treat",
      icon: "🍬",
      onClick: onTreat,
      disabled: !onTreat || !treatAvailable,
      tone: "#fb923c",
    },
    {
      id: "end",
      label: isEndingSession ? "Ending…" : "End Session",
      icon: "🏁",
      onClick: onEndSession,
      disabled: !onEndSession || isEndingSession,
      tone: "#f87171",
      destructive: true,
    },
  ];

  return (
    <div
      data-testid="gm-quick-controls"
      style={{
        padding: "12px 14px",
        borderRadius: 16,
        background: theme.surface,
        border: `1px solid ${theme.surfaceBorder}`,
        color: theme.text,
        boxShadow: "0 12px 28px rgba(15,23,42,0.25)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: "0.66rem",
          fontWeight: 900,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: theme.textMuted,
          marginRight: 6,
        }}
      >
        Game Master
      </div>
      {chips.map((c) => (
        <ChipButton key={c.id} chip={c} theme={theme} />
      ))}
    </div>
  );
}

function ChipButton({ chip, theme }) {
  const tone = chip.tone || theme.accent;
  const bg = chip.active
    ? `linear-gradient(135deg, ${tone}, ${theme.accent})`
    : `rgba(255,255,255,0.06)`;
  return (
    <button
      type="button"
      data-testid={`gm-chip-${chip.id}`}
      onClick={chip.onClick}
      disabled={chip.disabled}
      aria-pressed={!!chip.active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: 999,
        border: `1px solid ${chip.disabled ? "rgba(255,255,255,0.10)" : tone}`,
        background: bg,
        color: chip.disabled ? "rgba(255,255,255,0.40)" : "#fff",
        fontWeight: 900,
        fontSize: "0.82rem",
        letterSpacing: 0.2,
        cursor: chip.disabled ? "not-allowed" : "pointer",
        opacity: chip.disabled ? 0.55 : 1,
        boxShadow: chip.active ? `0 0 14px ${tone}66` : "none",
        transition: "transform 0.16s ease-out, background 0.2s ease-out, box-shadow 0.2s ease-out",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (chip.disabled) return;
        e.currentTarget.style.transform = "translateY(-1px)";
        if (!chip.active) e.currentTarget.style.background = `rgba(255,255,255,0.10)`;
      }}
      onMouseLeave={(e) => {
        if (chip.disabled) return;
        e.currentTarget.style.transform = "translateY(0)";
        if (!chip.active) e.currentTarget.style.background = `rgba(255,255,255,0.06)`;
      }}
    >
      <span aria-hidden="true">{chip.icon}</span>
      <span>{chip.label}</span>
    </button>
  );
}
