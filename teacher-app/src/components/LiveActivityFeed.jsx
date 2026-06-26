// teacher-app/src/components/LiveActivityFeed.jsx
//
// Pass-2 broadcast-style activity feed for the Live Session redesign.
// Renders the most recent room events as a vertical list with team
// colour, action description, points earned, and time-ago. The most
// recent event is highlighted as a celebration card at the bottom of
// the feed (mirrors the mockup's "BLUE PHARAOHS JUST COMPLETED
// STATION 3!" treatment).
//
// Pure presentation — reads existing state, emits nothing, mutates
// nothing.

import React, { useEffect, useState } from "react";

const PALETTES = [
  { id: 0, primary: "#3b82f6", glow: "rgba(59,130,246,0.45)", icon: "⭐" },
  { id: 1, primary: "#ef4444", glow: "rgba(239,68,68,0.45)",  icon: "🏆" },
  { id: 2, primary: "#10b981", glow: "rgba(16,185,129,0.45)", icon: "⚡" },
  { id: 3, primary: "#f59e0b", glow: "rgba(245,158,11,0.45)", icon: "⭐" },
  { id: 4, primary: "#a855f7", glow: "rgba(168,85,247,0.45)", icon: "🏆" },
  { id: 5, primary: "#fb923c", glow: "rgba(251,146,60,0.45)", icon: "⚡" },
];

function _hash(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) h = ((h * 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function paletteFor(teamId) {
  return PALETTES[_hash(teamId) % PALETTES.length];
}

function relativeTime(ts) {
  if (!ts) return "just now";
  const delta = Math.max(0, Date.now() - ts);
  const sec = Math.round(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

/**
 * LiveActivityFeed
 *
 * events  — array of normalised activity items:
 *           { id, teamId, teamName, action, points, timestamp }
 *           Most recent FIRST.
 * maxRows — how many recent items to show in the list (default 5)
 */
export default function LiveActivityFeed({ events = [], maxRows = 5 }) {
  // Force a re-render every 30s so the "X min ago" labels stay fresh
  // without needing the parent to tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (events.length === 0) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [events.length]);

  const rows = events.slice(0, maxRows);
  const latest = rows[0] || null;

  return (
    <div
      data-testid="live-activity-feed"
      style={{
        padding: "18px 18px 20px",
        borderRadius: 22,
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        border: "1px solid rgba(148,163,184,0.18)",
        boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        minHeight: 360,
      }}
    >
      <style>{`
        @keyframes lafFadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes lafCelebrate { 0% { transform: scale(0.96) } 50% { transform: scale(1.02) } 100% { transform: scale(1) } }
        @keyframes lafSpark { 0%,100% { opacity: 0.4 } 50% { opacity: 1 } }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase", color: "#cbd5e1" }}>
          Live Activity Feed
        </div>
        <span
          style={{
            fontSize: "0.66rem",
            fontWeight: 800,
            color: "#a5b4fc",
            letterSpacing: 0.5,
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid rgba(165,180,252,0.35)",
          }}
        >
          LIVE
        </span>
      </div>

      {/* Recent rows */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
        {rows.length === 0 && (
          <div style={{ padding: "30px 0", textAlign: "center", color: "#64748b", fontSize: "0.85rem" }}>
            Activity will appear here once the session starts.
          </div>
        )}
        {rows.map((ev, i) => {
          const palette = paletteFor(ev.teamId || ev.teamName || ev.id);
          return (
            <div
              key={ev.id || `${ev.teamId}:${ev.timestamp}:${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(148,163,184,0.10)",
                animation: `lafFadeIn 0.34s cubic-bezier(.22,1,.36,1) ${i * 40}ms both`,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: palette.primary,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.1rem",
                  flexShrink: 0,
                  boxShadow: `0 0 0 2px rgba(255,255,255,0.10), 0 4px 10px ${palette.glow}`,
                }}
                aria-hidden="true"
              >
                {ev.icon || palette.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.86rem",
                    fontWeight: 900,
                    color: palette.primary,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {ev.teamName || "Team"}
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "#cbd5e1",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {ev.action || "Activity"}
                </div>
                <div style={{ fontSize: "0.66rem", color: "#64748b", marginTop: 2, fontWeight: 700 }}>
                  {relativeTime(ev.timestamp)}
                </div>
              </div>
              {typeof ev.points === "number" && ev.points !== 0 && (
                <div
                  style={{
                    fontSize: "0.84rem",
                    fontWeight: 900,
                    color: ev.points > 0 ? "#86efac" : "#fca5a5",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    paddingLeft: 8,
                  }}
                >
                  {ev.points > 0 ? "+" : ""}{ev.points} pts
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Celebration card for the most recent event */}
      {latest && (
        <div
          style={{
            marginTop: 14,
            position: "relative",
            padding: "16px 18px",
            borderRadius: 14,
            background: "linear-gradient(135deg, rgba(168,85,247,0.32) 0%, rgba(59,130,246,0.24) 100%)",
            border: "1px solid rgba(196,181,253,0.45)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 12,
            animation: "lafCelebrate 0.6s cubic-bezier(.22,1,.36,1)",
            overflow: "hidden",
          }}
          key={`celebrate:${latest.id || latest.timestamp}`}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 12% 28%, rgba(255,255,255,0.16), transparent 50%), " +
                "radial-gradient(circle at 88% 70%, rgba(255,255,255,0.10), transparent 55%)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              fontSize: "1.6rem",
              animation: "lafSpark 1.6s ease-in-out infinite",
            }}
          >
            🏆
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <div style={{ fontSize: "0.7rem", letterSpacing: 0.6, fontWeight: 800, color: "#fef3c7", textTransform: "uppercase" }}>
              Most recent
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#fff", lineHeight: 1.2, marginTop: 2 }}>
              {(latest.teamName || "Team").toUpperCase()} {latest.action ? latest.action.toLowerCase() : "scored"}
              {typeof latest.points === "number" && latest.points !== 0 ? `  ·  ${latest.points > 0 ? "+" : ""}${latest.points} pts` : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
