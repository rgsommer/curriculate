// teacher-app/src/components/SessionModeToggle.jsx
//
// Pass-3 pillar for the Live Session redesign. Names the two modes
// the page has always done both of, and makes them explicit:
//
//   🎛  COMMAND CENTER — dense controls, professional, information-rich.
//                       What the teacher uses to set up + diagnose.
//   🎬  GAME MASTER MODE — broadcast layer, energy, momentum.
//                          What the teacher uses while teaching.
//
// Same underlying session state. Different presentation. One button
// between them. Choice persists across sessions in localStorage so a
// teacher who prefers Game Master Mode stays in it next time they open.
//
// Backed by useSessionMode(). When the toggle isn't mounted, the hook
// still works on its own — the LiveSession render reads the mode and
// shows / hides surfaces accordingly.

import React, { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "curriculate.sessionMode";
const VALID_MODES = new Set(["command-center", "game-master"]);

/**
 * useSessionMode — small hook that mirrors the persisted choice into
 * React state. Default "command-center" so first-time visitors get
 * the familiar controls; second visit they return to whichever mode
 * they last left.
 */
export function useSessionMode() {
  const [mode, setModeState] = useState(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      return VALID_MODES.has(v) ? v : "command-center";
    } catch {
      return "command-center";
    }
  });

  const setMode = useCallback((next) => {
    const safe = VALID_MODES.has(next) ? next : "command-center";
    setModeState(safe);
    try { window.localStorage.setItem(STORAGE_KEY, safe); } catch {}
  }, []);

  // Listen for cross-tab changes so a teacher with two windows open
  // (e.g. laptop + projector) sees the toggle stay in sync.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && VALID_MODES.has(e.newValue)) {
        setModeState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [mode, setMode];
}

/**
 * SessionModeToggle — the pill itself. Renders as a two-button
 * segmented control. Visual styling adapts to the chosen mode so the
 * toggle FEELS like part of whichever experience the teacher is in.
 *
 * Props:
 *   mode     — current mode ("command-center" | "game-master")
 *   onChange — setter (next: string) => void
 *   compact  — shrink for narrow viewports (optional)
 */
export default function SessionModeToggle({ mode, onChange, compact = false }) {
  const isGM = mode === "game-master";
  const BUTTONS = [
    { id: "command-center", label: "Command Center", icon: "🎛", sub: "Controls" },
    { id: "game-master",    label: "Game Master Mode", icon: "🎬", sub: "Broadcast" },
  ];

  return (
    <div
      data-testid="session-mode-toggle"
      role="group"
      aria-label="Session presentation mode"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: 4,
        borderRadius: 999,
        background: isGM
          ? "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(56,189,248,0.18))"
          : "rgba(15,23,42,0.06)",
        border: isGM
          ? "1px solid rgba(196,181,253,0.55)"
          : "1px solid rgba(15,23,42,0.10)",
        boxShadow: isGM
          ? "0 8px 24px rgba(168,85,247,0.25)"
          : "0 1px 3px rgba(15,23,42,0.06)",
        transition: "background 0.25s ease-out, box-shadow 0.25s ease-out, border-color 0.25s ease-out",
      }}
    >
      {BUTTONS.map((b) => {
        const active = mode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange?.(b.id)}
            aria-pressed={active}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: compact ? "6px 12px" : "8px 16px",
              borderRadius: 999,
              border: "none",
              background: active
                ? b.id === "game-master"
                  ? "linear-gradient(135deg, #a855f7 0%, #6366f1 50%, #3b82f6 100%)"
                  : "#0f172a"
                : "transparent",
              color: active ? "#fff" : "#475569",
              fontWeight: 800,
              fontSize: compact ? "0.78rem" : "0.85rem",
              letterSpacing: 0.2,
              cursor: "pointer",
              transition: "transform 0.18s ease-out, background 0.25s ease-out, color 0.25s ease-out",
              transform: active ? "translateY(-1px)" : "translateY(0)",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "#0f172a"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "#475569"; }}
          >
            <span aria-hidden="true" style={{ fontSize: compact ? "0.9rem" : "1rem" }}>{b.icon}</span>
            <span>{b.label}</span>
            {!compact && (
              <span
                style={{
                  fontSize: "0.62rem",
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  opacity: active ? 0.78 : 0.55,
                }}
              >
                {b.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
