// student-app/src/components/SuperpowerBadge.jsx
//
// Reveal card for a superpower the team was secretly assigned at
// join time. Rare (~1 in 4 teams), sticky per (device + roomCode),
// server-authoritative — see shared/superpowers.js and
// backend/services/superpowerAssignment.js.
//
// Visual choice: this is meant to feel like a treasure card the
// student unwraps. Big emoji, glowing frame, warm gradient, a
// "SECRET POWER" chip so kids know not to shout it to other teams.
//
// Activation: for now, only 🔍 Free Clue actually does something
// when the button is tapped. Every other power renders the card
// with a "Coming soon" hint under the button so the student still
// gets the excitement of holding a rare card. Follow-up phases wire
// each power's activation.

import React, { useEffect, useState } from "react";

export default function SuperpowerBadge({
  superpower,
  onActivate,
  usedAt,
}) {
  const [expanded, setExpanded] = useState(true);
  const [flash, setFlash] = useState(false);

  // Small "arrived" flash animation on first render.
  useEffect(() => {
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, []);

  if (!superpower) return null;

  const alreadyUsed = !!usedAt;
  const activationImplemented = superpower.id === "free_clue";

  return (
    <div
      data-testid="superpower-badge"
      style={{
        position: "relative",
        margin: "12px 0",
        padding: expanded ? "18px 20px 20px" : "12px 16px",
        borderRadius: 20,
        background: "linear-gradient(160deg, #fff9ea 0%, #fef3c7 65%, #fde68a 100%)",
        border: "2px solid #f59e0b",
        boxShadow: flash
          ? "0 0 32px rgba(245,158,11,0.55), 0 12px 30px rgba(180,83,9,0.25)"
          : "0 6px 22px rgba(180,83,9,0.20)",
        color: "#7c2d12",
        transition: "padding 0.25s ease-out, box-shadow 0.7s ease-out",
      }}
    >
      <style>{`
        @keyframes spSparkle {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }
      `}</style>

      {/* Secret chip so kids know not to shout it */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          padding: "3px 10px",
          borderRadius: 999,
          background: "#7c2d12",
          color: "#fef3c7",
          fontSize: "0.62rem",
          fontWeight: 900,
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        🤫 Secret
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "inherit",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            fontSize: expanded ? "2.6rem" : "1.6rem",
            animation: flash ? "spSparkle 0.9s ease-out" : "none",
            filter: "drop-shadow(0 2px 6px rgba(180,83,9,0.35))",
            transition: "font-size 0.25s ease-out",
          }}
        >
          {superpower.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.66rem", fontWeight: 900, letterSpacing: 0.8, opacity: 0.72 }}>
            YOUR TEAM'S SUPERPOWER
          </div>
          <div style={{ fontSize: expanded ? "1.35rem" : "1.05rem", fontWeight: 900, marginTop: 2 }}>
            {superpower.name}
          </div>
        </div>
        <div style={{ fontSize: "0.85rem", opacity: 0.6 }}>{expanded ? "▾" : "▸"}</div>
      </button>

      {expanded && (
        <>
          <div style={{ marginTop: 12, fontSize: "0.92rem", lineHeight: 1.5 }}>
            {superpower.description}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="superpower-activate"
              disabled={alreadyUsed || !activationImplemented || !onActivate}
              onClick={() => {
                if (alreadyUsed || !activationImplemented || !onActivate) return;
                onActivate(superpower);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                border: "none",
                background: alreadyUsed || !activationImplemented
                  ? "rgba(120,53,15,0.15)"
                  : "linear-gradient(135deg, #f59e0b, #d97706)",
                color: alreadyUsed || !activationImplemented ? "#7c2d12" : "#fff",
                fontWeight: 900,
                fontSize: "0.9rem",
                letterSpacing: 0.4,
                cursor: alreadyUsed || !activationImplemented ? "not-allowed" : "pointer",
                boxShadow: alreadyUsed || !activationImplemented
                  ? "none"
                  : "0 8px 22px rgba(217,119,6,0.35)",
                opacity: alreadyUsed ? 0.5 : 1,
              }}
            >
              {alreadyUsed ? "Already used" : `Use ${superpower.emoji} ${superpower.name}`}
            </button>

            {!activationImplemented && !alreadyUsed && (
              <span style={{ fontSize: "0.78rem", opacity: 0.75 }}>
                Coming soon — hold onto it as a bragging chip for now.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
