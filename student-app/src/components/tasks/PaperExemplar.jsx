// student-app/src/components/tasks/PaperExemplar.jsx
// Shows a ruled-paper mockup so students see exactly how to lay out their work.
// Per-player: shows separate mini-sheets side by side, each with the player's name.
// Group mode: shows one sheet with "Group Answer" header.
import React, { useState } from "react";

const RULED_LINE_COLOR = "#c8d5e3";
const MARGIN_COLOR = "#ef4444";
const PAPER_BG = "#fffef7";
const PLAYER_COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

function MiniSheet({ name, color, lineCount = 8, sampleText = "", height = 180 }) {
  const lines = [];
  const lineH = Math.floor((height - 32) / lineCount);
  for (let i = 0; i < lineCount; i++) {
    lines.push(
      <div
        key={i}
        style={{
          borderBottom: `1px solid ${RULED_LINE_COLOR}`,
          height: lineH,
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {/* Ghost sample text on first line of first sheet */}
        {i === 0 && sampleText && (
          <span style={{
            position: "absolute",
            left: 4,
            top: 2,
            fontSize: "0.55rem",
            color: "#c4b5a0",
            fontFamily: "'Caveat', 'Comic Sans MS', cursive, sans-serif",
            fontStyle: "italic",
            pointerEvents: "none",
          }}>
            {sampleText.length > 30 ? sampleText.slice(0, 30) + "…" : sampleText}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      flex: "1 1 0",
      minWidth: 90,
      maxWidth: 160,
      border: "2px solid #cbd5e1",
      borderRadius: 5,
      background: PAPER_BG,
      overflow: "hidden",
      position: "relative",
      height,
      boxShadow: "2px 3px 8px rgba(0,0,0,0.10)",
    }}>
      {/* Red margin line */}
      <div style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 20,
        width: 1,
        background: MARGIN_COLOR,
        opacity: 0.4,
        zIndex: 2,
      }} />

      {/* Player name at top */}
      <div style={{
        padding: "6px 6px 4px 24px",
        borderBottom: `2px solid ${RULED_LINE_COLOR}`,
        fontSize: "0.75rem",
        fontWeight: 900,
        color,
        fontFamily: "'Caveat', 'Comic Sans MS', cursive, sans-serif",
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        {name}
      </div>

      {/* Ruled lines */}
      <div style={{ paddingLeft: 24, paddingRight: 4, paddingTop: 2 }}>
        {lines}
      </div>
    </div>
  );
}

export default function PaperExemplar({
  memberNames = [],
  groupMode = false,
  samplePrompts = [],
  taskLabel = "",
}) {
  const [open, setOpen] = useState(false);
  const names = (Array.isArray(memberNames) ? memberNames : []).filter(Boolean);
  const playerCount = names.length || 3;
  const displayNames = names.length ? names : ["Player 1", "Player 2", "Player 3"];

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 10,
          border: "1px solid #d1d5db",
          background: "#fff",
          color: "#374151",
          fontSize: "0.82rem",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: 10,
        }}
      >
        📄 See how to set up your paper
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              maxHeight: "85vh",
              overflowY: "auto",
              borderRadius: 18,
              background: "#fff",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              padding: 0,
            }}
          >
            {/* Header */}
            <div style={{
              padding: "16px 20px 12px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: "1rem", color: "#0f172a" }}>
                  How to set up your paper
                </div>
                <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 2 }}>
                  {groupMode
                    ? "One paper for the whole group"
                    : `Each player uses their own sheet of paper`}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "1.4rem",
                  color: "#9ca3af",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>

            {/* Paper mockup area */}
            <div style={{ padding: "16px 20px 20px" }}>
              {groupMode ? (
                /* Group mode: one sheet */
                <div style={{
                  border: "2px solid #cbd5e1",
                  borderRadius: 6,
                  background: PAPER_BG,
                  overflow: "hidden",
                  position: "relative",
                  minHeight: 220,
                  boxShadow: "2px 3px 8px rgba(0,0,0,0.10)",
                }}>
                  {/* Red margin */}
                  <div style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 36,
                    width: 1,
                    background: MARGIN_COLOR,
                    opacity: 0.4,
                    zIndex: 2,
                  }} />
                  {taskLabel && (
                    <div style={{
                      padding: "8px 10px 6px 44px",
                      borderBottom: `2px solid ${RULED_LINE_COLOR}`,
                      fontSize: "0.8rem",
                      fontWeight: 900,
                      color: "#6366f1",
                      fontFamily: "'Caveat', 'Comic Sans MS', cursive, sans-serif",
                    }}>
                      Group Answer
                    </div>
                  )}
                  <div style={{ paddingLeft: 44, paddingRight: 10, paddingTop: 4 }}>
                    {Array.from({ length: 8 }, (_, i) => (
                      <div key={i} style={{
                        borderBottom: `1px solid ${RULED_LINE_COLOR}`,
                        height: 24,
                      }} />
                    ))}
                  </div>
                </div>
              ) : (
                /* Per-player: separate sheets side by side */
                <div style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}>
                  {displayNames.slice(0, playerCount).map((name, idx) => (
                    <MiniSheet
                      key={idx}
                      name={name}
                      color={PLAYER_COLORS[idx % PLAYER_COLORS.length]}
                      lineCount={7}
                      height={190}
                      sampleText={idx === 0 && samplePrompts.length > 0 ? samplePrompts[0] : ""}
                    />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div style={{
                marginTop: 14,
                fontSize: "0.78rem",
                color: "#6b7280",
                textAlign: "center",
                lineHeight: 1.5,
              }}>
                {groupMode
                  ? "Write your group's answer together on one paper, then snap a photo."
                  : <>
                      Each player writes <strong>their name at the top</strong> of their own sheet,
                      then writes their answer below. When done, each player snaps a photo of their paper.
                    </>}
              </div>

              {/* Close button */}
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "#fff",
                  fontSize: "0.95rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
