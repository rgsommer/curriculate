// teacher-app/src/components/DeviceModeSelector.jsx
//
// Phase 1a. Three-card device-mode picker for the pre-launch flow.
// Reads the current mode via prop, emits the choice via onChange.
// The parent (LiveSession) is responsible for round-tripping to the
// backend via `teacher:setDeviceMode` — this component owns display
// + click-to-select and nothing else.
//
// Locked mode: after a session goes live, the parent can pass
// `locked` and the cards become inspectable but not clickable.
// Reflects the spec's "once live, prevent accidental changes" rule
// without adding a confirm dialog to Phase 1.
//
// The copy strings + card list live in shared/deviceCapabilities.js
// so backend + student-app can render the same names later.

import React from "react";
import { DEVICE_MODES, DEVICE_MODE_CARDS } from "../../../shared/deviceCapabilities.js";

const CARD_ACCENTS = {
  [DEVICE_MODES.TABLET_ONLY]: {
    ring: "#38bdf8",
    glow: "rgba(56,189,248,0.35)",
    ink: "#0f172a",
  },
  [DEVICE_MODES.LAPTOP_ONLY]: {
    ring: "#a855f7",
    glow: "rgba(168,85,247,0.35)",
    ink: "#0f172a",
  },
  [DEVICE_MODES.MIXED]: {
    ring: "#f59e0b",
    glow: "rgba(245,158,11,0.35)",
    ink: "#0f172a",
  },
};

/**
 * DeviceModeSelector
 *
 * Props:
 *   mode       — current device mode string (defaults to tablet_only)
 *   onChange   — (nextMode: string) => void
 *   locked     — when true, disables clicks (session is live)
 *   compact    — shrink font-size + padding for tight spaces
 *   headline   — optional label above the row; pass null to hide
 */
export default function DeviceModeSelector({
  mode = DEVICE_MODES.TABLET_ONLY,
  onChange,
  locked = false,
  compact = false,
  headline = "Which devices will teams use?",
}) {
  return (
    <div data-testid="device-mode-selector" style={{ width: "100%" }}>
      {headline !== null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 12,
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: compact ? "0.82rem" : "0.92rem",
              fontWeight: 900,
              color: "#0f172a",
              letterSpacing: 0.2,
            }}
          >
            {headline}
          </div>
          {locked && (
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 800,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                padding: "3px 8px",
                borderRadius: 999,
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
              }}
            >
              🔒 Locked (session live)
            </span>
          )}
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Device mode"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 12,
        }}
      >
        {DEVICE_MODE_CARDS.map((card) => {
          const active = card.id === mode;
          const accent = CARD_ACCENTS[card.id] || CARD_ACCENTS[DEVICE_MODES.TABLET_ONLY];
          const clickable = !locked && typeof onChange === "function";

          return (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={locked}
              data-testid={`device-mode-card-${card.id}`}
              onClick={() => clickable && onChange(card.id)}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                textAlign: "left",
                padding: compact ? "14px 14px" : "16px 18px",
                borderRadius: 18,
                background: active
                  ? `linear-gradient(160deg, #fff 0%, ${accent.glow} 240%)`
                  : "#ffffff",
                border: `2px solid ${active ? accent.ring : "#e2e8f0"}`,
                boxShadow: active
                  ? `0 12px 30px ${accent.glow}, 0 0 0 4px rgba(255,255,255,0.7)`
                  : "0 3px 10px rgba(15,23,42,0.06)",
                color: accent.ink,
                cursor: clickable ? "pointer" : "not-allowed",
                opacity: locked && !active ? 0.55 : 1,
                transition:
                  "transform 0.16s ease-out, box-shadow 0.22s ease-out, border-color 0.22s ease-out",
                transform: active ? "translateY(-1px)" : "translateY(0)",
              }}
              onMouseEnter={(e) => {
                if (!clickable || active) return;
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.borderColor = accent.ring;
                e.currentTarget.style.boxShadow = `0 8px 22px ${accent.glow}`;
              }}
              onMouseLeave={(e) => {
                if (active) return;
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.boxShadow = "0 3px 10px rgba(15,23,42,0.06)";
              }}
            >
              {/* Icon + selected checkmark */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: compact ? "1.65rem" : "1.95rem",
                    filter: active ? `drop-shadow(0 0 12px ${accent.glow})` : "none",
                  }}
                >
                  {card.icon}
                </span>
                {active && (
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: accent.ring,
                      color: "#fff",
                      fontSize: "0.72rem",
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: `0 0 12px ${accent.glow}`,
                    }}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                )}
              </div>

              {/* Title + tagline */}
              <div>
                <div
                  style={{
                    fontSize: compact ? "1rem" : "1.08rem",
                    fontWeight: 900,
                    lineHeight: 1.2,
                    color: accent.ink,
                  }}
                >
                  {card.title}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: compact ? "0.75rem" : "0.8rem",
                    color: "#475569",
                    fontWeight: 600,
                  }}
                >
                  {card.tagline}
                </div>
              </div>

              {/* Blurb */}
              <div
                style={{
                  marginTop: 2,
                  fontSize: compact ? "0.78rem" : "0.82rem",
                  lineHeight: 1.42,
                  color: "#334155",
                }}
              >
                {card.blurb}
              </div>

              {/* Best-for chip */}
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: 8,
                  borderTop: "1px dashed #e2e8f0",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#64748b",
                  letterSpacing: 0.2,
                }}
              >
                <span style={{ opacity: 0.8 }}>Best for:</span> {card.bestFor}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
