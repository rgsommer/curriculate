// teacher-app/src/components/StageTimeline.jsx
//
// Pass-4. Horizontal stage timeline for the Game Master broadcast
// layer. Reads the existing taskIndex + totalTasks and renders the
// arc of the session:
//
//   ● Warm-up   ─ ◐ Round 2 ─ ○ Round 3 ─ … ─ ☆ Final Challenge
//
// Pure presentation. Theme-aware: round/warmup/final labels come
// from the active theme (so Ancient Egypt shows "Scroll N" and
// "Pharaoh's Test", Mission Control shows "T-N" and "Splashdown",
// etc).
//
// Caps visible-stop count at ~9 for legibility; when more rounds
// exist we collapse middle rounds into a "+N more" pill so the bar
// stays glanceable on projector resolutions.

import React from "react";
import { getTheme } from "./themes";

const MAX_VISIBLE_ROUNDS = 7;

/**
 * Props:
 *   taskIndex   — current 0-based index (–1 if not started)
 *   totalTasks  — total rounds (excluding Warm-up + Final framing)
 *   themeId     — theme id; defaults to neon-night
 *   status      — optional status string for the connecting-line gradient
 *   isActive    — true once the session has started; affects warmup glow
 */
export default function StageTimeline({
  taskIndex = -1,
  totalTasks = 0,
  themeId = "neon-night",
  status = "",
  isActive = false,
}) {
  const theme = getTheme(themeId);
  if (totalTasks <= 0) return null;

  // The visible stop list is built from theme labels:
  //   [Warm-up, Round 1, Round 2, …, Final]
  // We always show Warm-up + every round (or a collapsed window) +
  // Final. The "Final" stop is the last actual round under a flavour
  // label; we don't add an extra phantom step.
  const stops = [];
  stops.push({ id: "warmup", label: theme.warmupLabel, kind: "warmup" });

  const roundCount = totalTasks;
  const finalIdx = roundCount - 1;

  if (roundCount <= MAX_VISIBLE_ROUNDS) {
    for (let i = 0; i < roundCount; i += 1) {
      stops.push({
        id: `r${i}`,
        label: i === finalIdx ? theme.finalLabel : theme.roundLabel(i + 1),
        kind: i === finalIdx ? "final" : "round",
        idx: i,
      });
    }
  } else {
    // Show first 2 rounds, a "+N" gap, and the last 2 rounds + Final.
    const headCount = 2;
    const tailCount = 2; // (last round before final + final)
    for (let i = 0; i < headCount; i += 1) {
      stops.push({
        id: `r${i}`,
        label: theme.roundLabel(i + 1),
        kind: "round",
        idx: i,
      });
    }
    const gapCount = roundCount - headCount - tailCount;
    stops.push({
      id: "gap",
      label: `+${gapCount} more`,
      kind: "gap",
    });
    for (let i = roundCount - tailCount; i < roundCount; i += 1) {
      stops.push({
        id: `r${i}`,
        label: i === finalIdx ? theme.finalLabel : theme.roundLabel(i + 1),
        kind: i === finalIdx ? "final" : "round",
        idx: i,
      });
    }
  }

  // State helper. taskIndex === -1 → only Warm-up active.
  const stateFor = (stop) => {
    if (stop.kind === "warmup") {
      if (taskIndex < 0) return "current";
      return "done";
    }
    if (stop.kind === "gap") {
      // Gap is "done" once any round inside it has been reached.
      const earliestGapRound = 2;
      return taskIndex >= earliestGapRound ? "done" : "upcoming";
    }
    if (typeof stop.idx !== "number") return "upcoming";
    if (stop.idx < taskIndex) return "done";
    if (stop.idx === taskIndex) return "current";
    return "upcoming";
  };

  return (
    <div
      data-testid="stage-timeline"
      style={{
        padding: "14px 16px",
        borderRadius: 16,
        background: theme.surface,
        border: `1px solid ${theme.surfaceBorder}`,
        color: theme.text,
        boxShadow: `0 12px 28px rgba(15,23,42,0.25)`,
      }}
    >
      <div
        style={{
          fontSize: "0.68rem",
          fontWeight: 800,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: theme.textMuted,
          marginBottom: 10,
        }}
      >
        Session arc{isActive && status ? ` · ${status}` : ""}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          overflowX: "auto",
        }}
      >
        {stops.map((stop, i) => {
          const state = stateFor(stop);
          const isLast = i === stops.length - 1;
          return (
            <React.Fragment key={stop.id}>
              <Stop stop={stop} state={state} theme={theme} />
              {!isLast && <Connector state={state} theme={theme} />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Stop({ stop, state, theme }) {
  const isGap = stop.kind === "gap";
  const dotBg =
    state === "done"
      ? theme.accent
      : state === "current"
      ? theme.accentSecondary
      : "rgba(255,255,255,0.18)";
  const dotBorder = state === "current" ? theme.accent : "transparent";
  const labelColor =
    state === "done"
      ? theme.text
      : state === "current"
      ? theme.text
      : theme.textMuted;

  const dotIcon =
    stop.kind === "warmup"
      ? "✦"
      : stop.kind === "final"
      ? "★"
      : isGap
      ? `+${stop.label.replace(/[^\d]/g, "")}`
      : "●";

  return (
    <div
      data-testid={`stage-stop-${stop.id}`}
      data-stage-state={state}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: 88,
        flex: "0 0 auto",
        padding: "0 6px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: dotBg,
          border: `2px solid ${dotBorder}`,
          color: stop.kind === "final" ? "#1f2937" : "#0f172a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: isGap ? "0.62rem" : "0.85rem",
          fontWeight: 900,
          boxShadow:
            state === "current"
              ? `0 0 14px ${theme.streakGlow}, 0 0 0 4px ${theme.surface}`
              : "none",
          animation: state === "current" ? "stPulse 1.8s ease-in-out infinite" : "none",
        }}
      >
        {dotIcon}
      </div>
      <style>{`
        @keyframes stPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.10); } }
      `}</style>
      <div
        style={{
          marginTop: 6,
          fontSize: "0.72rem",
          fontWeight: 800,
          letterSpacing: 0.2,
          color: labelColor,
          textAlign: "center",
          whiteSpace: "nowrap",
          textTransform: stop.kind === "round" ? "uppercase" : "none",
        }}
      >
        {stop.label}
      </div>
    </div>
  );
}

function Connector({ state, theme }) {
  // "done" connector fills with accent; "current" partially fills;
  // "upcoming" stays dim. The connector ALWAYS sits between two
  // stops; here we mirror the right-hand stop's state.
  const fill =
    state === "done" || state === "current"
      ? theme.accent
      : "rgba(255,255,255,0.18)";
  return (
    <div
      style={{
        flex: "1 1 auto",
        minWidth: 24,
        height: 2,
        margin: "13px 0 0",
        background: fill,
        borderRadius: 999,
        alignSelf: "flex-start",
        opacity: state === "upcoming" ? 0.55 : 1,
        transition: "background 0.25s ease-out, opacity 0.25s ease-out",
      }}
    />
  );
}
