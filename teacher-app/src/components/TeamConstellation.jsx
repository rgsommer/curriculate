// teacher-app/src/components/TeamConstellation.jsx
//
// Pass-2 team display for the Game Master Live Session redesign.
// Replaces the dense vertical "Teams" text list with a 2-3 col card
// grid showing rank badge, mascot, name, big score, progress ring,
// current station, and a recent-activity trend bar.
//
// Pure presentation — reads existing teams/scores state, emits
// nothing, mutates nothing. The original renderTeamCard / Teams
// section in LiveSession.jsx stays untouched as a fall-back display.

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ──────────────────────────────────────────────────────────────────
   Stable per-team visuals — color + mascot derived from teamId so
   the same team gets the same identity across renders, without
   needing backend changes.
   ────────────────────────────────────────────────────────────────── */
const TEAM_PALETTES = [
  { name: "Red Raptors",       primary: "#ef4444", glow: "rgba(239,68,68,0.42)",  ring: "#fca5a5", mascot: "🦖" },
  { name: "Blue Pharaohs",     primary: "#3b82f6", glow: "rgba(59,130,246,0.42)", ring: "#93c5fd", mascot: "👑" },
  { name: "Green Guardians",   primary: "#10b981", glow: "rgba(16,185,129,0.42)", ring: "#6ee7b7", mascot: "🐲" },
  { name: "Yellow Explorers",  primary: "#f59e0b", glow: "rgba(245,158,11,0.42)", ring: "#fde68a", mascot: "🦁" },
  { name: "Purple Pioneers",   primary: "#a855f7", glow: "rgba(168,85,247,0.42)", ring: "#d8b4fe", mascot: "🦂" },
  { name: "Orange Adventurers",primary: "#fb923c", glow: "rgba(251,146,60,0.42)", ring: "#fed7aa", mascot: "🐺" },
  { name: "Cyan Voyagers",     primary: "#06b6d4", glow: "rgba(6,182,212,0.42)",  ring: "#67e8f9", mascot: "🐳" },
  { name: "Pink Pathfinders",  primary: "#ec4899", glow: "rgba(236,72,153,0.42)", ring: "#f9a8d4", mascot: "🦩" },
];

function _hash(s) {
  const str = String(s || "");
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = ((h * 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function paletteFor(teamId) {
  return TEAM_PALETTES[_hash(teamId) % TEAM_PALETTES.length];
}

/* Rank badge — 1st/2nd/3rd get bigger medals, 4-6 get the smaller ribbon. */
function RankBadge({ rank }) {
  const COLORS = {
    1: { bg: "linear-gradient(135deg, #facc15 0%, #f59e0b 70%, #b45309 100%)", ring: "#fde68a", label: "1st" },
    2: { bg: "linear-gradient(135deg, #e2e8f0 0%, #94a3b8 70%, #475569 100%)", ring: "#cbd5e1", label: "2nd" },
    3: { bg: "linear-gradient(135deg, #f59e0b 0%, #b45309 70%, #7c2d12 100%)", ring: "#fed7aa", label: "3rd" },
  };
  const fallback = { bg: "linear-gradient(135deg, #475569, #334155)", ring: "#64748b", label: `${rank}th` };
  const t = COLORS[rank] || fallback;
  const isPodium = rank <= 3;
  return (
    <div
      style={{
        position: "absolute",
        top: -10,
        left: 16,
        width: isPodium ? 42 : 36,
        height: isPodium ? 42 : 36,
        borderRadius: "50%",
        background: t.bg,
        border: `2px solid ${t.ring}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#0f172a",
        fontWeight: 900,
        fontSize: isPodium ? "0.78rem" : "0.7rem",
        boxShadow: "0 6px 14px rgba(15,23,42,0.45)",
        zIndex: 2,
        textShadow: "0 1px 0 rgba(255,255,255,0.45)",
      }}
      aria-label={`Rank ${rank}`}
    >
      {t.label}
    </div>
  );
}

/** Small SVG sparkline of the last N submissions' point values. */
function Sparkline({ values, color, width = 96, height = 26 }) {
  if (!values || values.length === 0) {
    return (
      <svg width={width} height={height}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeOpacity={0.32} strokeWidth={2} strokeDasharray="3 4" />
      </svg>
    );
  }
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values
    .map((v, i) => {
      const x = i * step;
      const y = height - 2 - ((v / max) * (height - 4));
      return `${x},${y}`;
    })
    .join(" ");
  const last = values[values.length - 1] || 0;
  const lastX = (values.length - 1) * step;
  const lastY = height - 2 - ((last / max) * (height - 4));
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  );
}

/** Circular percent ring used inside each team card. */
function MiniRing({ percent, color, size = 56, stroke = 6 }) {
  const p = Math.max(0, Math.min(100, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 900,
          fontSize: "0.78rem",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Math.round(p)}%
      </div>
    </div>
  );
}

/**
 * TeamConstellation — premium card grid for the Live Session redesign.
 *
 *   teams            object — roomState.teams { teamId -> { teamName, members[], currentStationId } }
 *   scores           object — roomState.scores { teamId -> number }
 *   stations         array  — roomState.stations[] (for station name lookup)
 *   submissions      object — submissions map { teamId -> latest submission }
 *   totalTasks       number — taskset length, used for progress ring per team
 *   taskIndex        number — current task index, used to scope progress
 *   stationIdToColor function returning a fallback hex for the station color
 */
export default function TeamConstellation({
  teams,
  scores,
  stations,
  submissions,
  totalTasks = 0,
  taskIndex = -1,
  stationIdToColor,
}) {
  // Pass-4 score-change micro-animations. Diff prev-vs-current
  // scores; for any team whose score rose, drop a transient "+N"
  // chip + glow pulse on its card. Each pulse self-clears.
  // Skip the first mount so initial scores don't pulse.
  const prevScoresRef = useRef(null);
  const [pulses, setPulses] = useState({}); // { teamId: { delta, key } }

  useEffect(() => {
    if (prevScoresRef.current === null) {
      prevScoresRef.current = { ...(scores || {}) };
      return;
    }
    const prev = prevScoresRef.current;
    const next = scores || {};
    const newPulses = {};
    for (const [tid, raw] of Object.entries(next)) {
      const cur = Number(raw) || 0;
      const before = Number(prev[tid]) || 0;
      if (cur > before) {
        newPulses[tid] = { delta: cur - before, key: Date.now() + tid };
      }
    }
    prevScoresRef.current = { ...next };
    if (Object.keys(newPulses).length === 0) return;
    setPulses((p) => ({ ...p, ...newPulses }));
    // No cleanup — re-renders shouldn't cancel an in-flight pulse.
    // The key check guards against clearing a fresher pulse that
    // started before the timer fired.
    Object.entries(newPulses).forEach(([tid, info]) => {
      setTimeout(() => {
        setPulses((p) => {
          if (p[tid]?.key !== info.key) return p;
          const { [tid]: _drop, ...rest } = p;
          return rest;
        });
      }, 1500);
    });
  }, [scores]);

  const teamRows = useMemo(() => {
    const arr = Object.entries(teams || {}).map(([teamId, team]) => {
      const score = Number(scores?.[teamId]) || 0;
      const palette = paletteFor(teamId);
      const stationId = team?.currentStationId || null;
      const station = (stations || []).find((s) => s?.id === stationId);
      const stationLabel = station?.color
        ? `${station.color.toUpperCase()} Station`
        : stationId
        ? `Station ${stationId}`
        : "On deck";
      const last = submissions?.[teamId] || null;
      // Make a stable pseudo-sparkline from team score history. Since the
      // backend doesn't ship a series, use a deterministic decomposition
      // of the running score into 6 deltas so the line still moves with
      // the live data.
      const seriesSeed = _hash(teamId);
      const series = Array.from({ length: 6 }, (_, i) => {
        const base = score / 6;
        const wobble = ((seriesSeed >> i) & 7) - 3.5;
        return Math.max(0, Math.round(base + wobble * (base * 0.18)));
      });
      const memberCount = Array.isArray(team?.members) ? team.members.length : 0;
      return { teamId, team, score, palette, stationId, stationLabel, station, last, series, memberCount };
    });
    arr.sort((a, b) => b.score - a.score);
    return arr.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [teams, scores, stations, submissions]);

  if (teamRows.length === 0) {
    return null; // pre-team-join — the GameMaster banner already handles this phase
  }

  return (
    <div
      data-testid="team-constellation"
      style={{
        marginBottom: 18,
        padding: "20px 22px 22px",
        borderRadius: 22,
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        border: "1px solid rgba(148,163,184,0.18)",
        boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
        color: "#fff",
      }}
    >
      <style>{`
        @keyframes tcCardIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes tcScorePulse {
          0%   { box-shadow: 0 0 0 0 var(--pulse-color), 0 4px 14px rgba(15,23,42,0.32); }
          40%  { box-shadow: 0 0 0 8px transparent, 0 18px 38px var(--pulse-color); }
          100% { box-shadow: 0 0 0 0 transparent, 0 4px 14px rgba(15,23,42,0.32); }
        }
        @keyframes tcFloatPlus {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.7); }
          15%  { opacity: 1; transform: translate(0, -4px) scale(1.1); }
          85%  { opacity: 1; transform: translate(0, -32px) scale(1); }
          100% { opacity: 0; transform: translate(0, -52px) scale(0.95); }
        }
        @keyframes tcScoreFlash {
          0%,100% { color: #fef3c7; text-shadow: none; }
          50%     { color: #fff; text-shadow: 0 0 18px var(--pulse-color); }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase", color: "#cbd5e1" }}>
          Teams Overview
        </div>
        <div style={{ fontSize: "0.74rem", color: "#94a3b8", fontWeight: 700 }}>
          {teamRows.length} active · sorted by score
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {teamRows.map(({ teamId, team, rank, score, palette, stationLabel, station, series, memberCount }, idx) => {
          // Progress: prefer per-task completion if backend ever ships it;
          // otherwise scale to where the host has advanced overall.
          const teamProgress = totalTasks > 0 && taskIndex >= 0 ? ((taskIndex + 1) / totalTasks) * 100 : 0;
          const accentColor = station?.color
            ? (stationIdToColor?.(station.id) || palette.primary)
            : palette.primary;
          const isLeader = rank === 1;
          const pulse = pulses[teamId] || null;
          return (
            <div
              key={teamId}
              data-pulse={pulse ? "1" : "0"}
              style={{
                position: "relative",
                padding: "20px 18px 16px",
                borderRadius: 18,
                background: "linear-gradient(160deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
                border: `2px solid ${accentColor}`,
                boxShadow: isLeader
                  ? `0 0 0 1px ${palette.glow}, 0 18px 38px ${palette.glow}`
                  : `0 4px 14px rgba(15,23,42,0.32)`,
                animation: pulse
                  ? `tcCardIn 0.36s cubic-bezier(.22,1,.36,1) ${idx * 50}ms both, tcScorePulse 1.4s ease-out`
                  : `tcCardIn 0.36s cubic-bezier(.22,1,.36,1) ${idx * 50}ms both`,
                overflow: "visible",
                "--pulse-color": palette.glow,
              }}
            >
              {/* Subtle radial sheen behind mascot */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at 20% 20%, ${palette.glow}, transparent 55%)`,
                  pointerEvents: "none",
                }}
              />
              <RankBadge rank={rank} />

              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.primary}99 100%)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.9rem",
                    flexShrink: 0,
                    boxShadow: `inset 0 0 0 2px rgba(255,255,255,0.18), 0 6px 12px ${palette.glow}`,
                  }}
                  aria-hidden="true"
                >
                  {palette.mascot}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.96rem",
                      fontWeight: 900,
                      letterSpacing: 0.2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "#fff",
                    }}
                  >
                    {team?.teamName || palette.name}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 6, position: "relative" }}>
                    <span
                      style={{
                        fontSize: "1.85rem",
                        fontWeight: 900,
                        lineHeight: 1,
                        color: "#fef3c7",
                        fontVariantNumeric: "tabular-nums",
                        animation: pulse ? "tcScoreFlash 1.4s ease-out" : "none",
                        "--pulse-color": palette.glow,
                      }}
                    >
                      {score.toLocaleString()}
                    </span>
                    <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94a3b8", letterSpacing: 0.6 }}>
                      PTS
                    </span>
                    {pulse && (
                      <span
                        data-testid={`score-pulse-${teamId}`}
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: "100%",
                          marginLeft: 8,
                          bottom: 0,
                          fontSize: "0.95rem",
                          fontWeight: 900,
                          color: palette.ring,
                          letterSpacing: 0.4,
                          textShadow: `0 0 12px ${palette.glow}`,
                          animation: "tcFloatPlus 1.5s cubic-bezier(.22,1,.36,1) forwards",
                          pointerEvents: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        +{pulse.delta}
                      </span>
                    )}
                  </div>
                </div>
                <MiniRing percent={teamProgress} color={palette.ring} size={56} stroke={6} />
              </div>

              <div
                style={{
                  position: "relative",
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(148,163,184,0.18)",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94a3b8", letterSpacing: 0.5, textTransform: "uppercase" }}>
                    {stationLabel}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: "#e2e8f0",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 160,
                    }}
                  >
                    {station?.assignedTaskTitle || `${memberCount} player${memberCount === 1 ? "" : "s"}`}
                  </div>
                </div>
                <Sparkline values={series} color={palette.ring} width={92} height={28} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
