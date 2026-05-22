// student-app/src/components/quest/QuestHud.jsx
//
// Read-only Quest Mode HUD (commit #4 of QUEST_MODE_PLAN.md).
//
// Mounted from StudentApp.jsx when the parent room's taskset has
// `questModeEnabled: true`. Subscribes to `quest:stateUpdated` socket
// broadcasts emitted by the backend coin economy after every task
// completion (see backend/services/questEconomy.js + handleStudentSubmit).
//
// Renders:
//   - coin balance (with animated bump on increase)
//   - inventory chips (e.g. rope ×3, water ×50)
//   - quest rank label if set
//
// Resource buy UI lands in commit #5; this component is intentionally read-only.
import React, { useEffect, useRef, useState } from "react";

export default function QuestHud({ socket, roomCode, teamId, enabled = true }) {
  const [state, setState] = useState(null);            // last seen { coins, inventory, ... }
  const [coinBump, setCoinBump] = useState(null);      // { delta, key } for short pop animation
  const prevCoinsRef = useRef(0);
  const popKeyRef = useRef(0);

  // Subscribe to broadcasts AND fetch initial state on mount.
  useEffect(() => {
    if (!enabled || !socket || !roomCode || !teamId) return;

    let cancelled = false;

    // Ask for current snapshot (in case session was already in progress)
    try {
      socket.emit("quest:requestState", { roomCode, teamId }, (resp) => {
        if (cancelled || !resp || !resp.ok || !resp.state) return;
        setState(resp.state);
        prevCoinsRef.current = Number(resp.state.coins) || 0;
      });
    } catch { /* socket may not implement requestState yet — that's fine */ }

    const onUpdate = (next) => {
      if (!next || cancelled) return;
      setState(next);
      const prevCoins = prevCoinsRef.current;
      const nowCoins = Number(next.coins) || 0;
      if (nowCoins > prevCoins) {
        popKeyRef.current += 1;
        setCoinBump({ delta: nowCoins - prevCoins, key: popKeyRef.current });
      }
      prevCoinsRef.current = nowCoins;
    };

    socket.on("quest:stateUpdated", onUpdate);
    return () => {
      cancelled = true;
      socket.off("quest:stateUpdated", onUpdate);
    };
  }, [enabled, socket, roomCode, teamId]);

  // Clear the coin bump after a short animation window
  useEffect(() => {
    if (!coinBump) return;
    const t = setTimeout(() => setCoinBump(null), 1400);
    return () => clearTimeout(t);
  }, [coinBump]);

  if (!enabled) return null;

  // Render even before first state arrives so the HUD slot stays consistent
  const coins = Number(state?.coins) || 0;
  const inventory = state?.inventory && typeof state.inventory === "object" ? state.inventory : {};
  const inventoryKeys = Object.keys(inventory).filter((k) => Number(inventory[k]) > 0);
  const rank = state?.questRank;

  return (
    <div style={wrap}>
      <div style={labelChip}>Quest Mode</div>

      <div style={coinWrap}>
        <span role="img" aria-label="coin" style={{ fontSize: "1.1rem" }}>🪙</span>
        <span style={coinNumber}>{coins}</span>
        <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>coins</span>
        {coinBump && (
          <span key={coinBump.key} style={coinBumpStyle}>
            +{coinBump.delta}
          </span>
        )}
      </div>

      {inventoryKeys.length > 0 && (
        <div style={inventoryWrap}>
          {inventoryKeys.map((k) => (
            <span key={k} style={invChip}>
              {k} <strong style={{ marginLeft: 4 }}>×{inventory[k]}</strong>
            </span>
          ))}
        </div>
      )}

      {rank ? <div style={rankPill}>Rank: {rank}</div> : null}

      <style>{`
        @keyframes quest-bump {
          0%   { transform: translateY(0)     scale(0.6); opacity: 0; }
          30%  { transform: translateY(-6px)  scale(1.1); opacity: 1; }
          100% { transform: translateY(-22px) scale(1);   opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  padding: "8px 14px",
  margin: "8px 0",
  background: "linear-gradient(135deg, rgba(124,58,237,0.16), rgba(34,197,94,0.10))",
  border: "1px solid rgba(124,58,237,0.35)",
  borderRadius: 12,
  color: "#f1f5f9",
  fontSize: "0.9rem",
};
const labelChip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#c4b5fd",
  padding: "2px 8px",
  background: "rgba(124,58,237,0.18)",
  borderRadius: 999,
};
const coinWrap = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontWeight: 700,
};
const coinNumber = {
  fontVariantNumeric: "tabular-nums",
  fontSize: "1.05rem",
  color: "#fbbf24",
};
const coinBumpStyle = {
  position: "absolute",
  right: "-12px",
  top: "-4px",
  color: "#22c55e",
  fontWeight: 700,
  fontSize: "0.85rem",
  pointerEvents: "none",
  animation: "quest-bump 1.2s ease-out forwards",
};
const inventoryWrap = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};
const invChip = {
  fontSize: "0.78rem",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(34,197,94,0.14)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#bbf7d0",
};
const rankPill = {
  fontSize: "0.75rem",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(251,191,36,0.14)",
  border: "1px solid rgba(251,191,36,0.35)",
  color: "#fde68a",
  fontWeight: 600,
};
