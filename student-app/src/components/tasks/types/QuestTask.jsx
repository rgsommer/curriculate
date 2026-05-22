// student-app/src/components/tasks/types/QuestTask.jsx
//
// Renderer for the "quest" task type — the mission card.
// Shows:
//   - mission title + narrative scenario
//   - each objective with progress bar (required vs current inventory)
//   - the resource list, with Buy buttons (coin acquisition path)
//   - "Launch Mission" CTA when all objective resources are met
//
// State source of truth: the server. We fetch via quest:requestState on mount,
// and re-fetch after every quest:stateUpdated broadcast.
import React, { useEffect, useMemo, useState } from "react";

export default function QuestTask({ task, onSubmit, disabled, socket, roomCode, teamId, taskIndex }) {
  const cfg = task?.config || {};
  const objectives = Array.isArray(cfg.objectives) ? cfg.objectives : [];
  const resources  = Array.isArray(cfg.resources)  ? cfg.resources  : [];
  const ranks      = Array.isArray(cfg.ranks)      ? cfg.ranks      : [];

  const [state, setState] = useState(null);     // { coins, inventory, ... } from server
  const [busyResId, setBusyResId] = useState(null);
  const [error, setError] = useState(null);

  const isLive = !!(socket && roomCode && teamId);

  // Snapshot fetch + subscribe to updates
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    socket.emit("quest:requestState", { roomCode, teamId }, (resp) => {
      if (cancelled || !resp?.ok) return;
      setState(resp.state || null);
    });
    const onUpdate = (s) => { if (!cancelled && s) setState(s); };
    socket.on("quest:stateUpdated", onUpdate);
    return () => { cancelled = true; socket.off("quest:stateUpdated", onUpdate); };
  }, [isLive, socket, roomCode, teamId]);

  const inv = state?.inventory && typeof state.inventory === "object" ? state.inventory : {};
  const coins = Number(state?.coins) || 0;

  // Compute objective progress
  const objectivesProgress = useMemo(() => {
    return objectives.map((o, i) => {
      const req = (o && o.requiredResources) || {};
      const lines = Object.entries(req).map(([rid, need]) => ({
        rid,
        need: Number(need) || 0,
        have: Number(inv[rid]) || 0,
      }));
      const allMet = lines.every((l) => l.have >= l.need);
      return { ...o, idx: i, lines, allMet };
    });
  }, [objectives, inv]);

  const allObjectivesMet = objectivesProgress.length > 0 && objectivesProgress.every((o) => o.allMet);

  const handleBuy = (resourceId) => {
    if (!isLive) return;
    setBusyResId(resourceId);
    setError(null);
    socket.emit(
      "quest:acquireResource",
      { roomCode, teamId, taskIndex, resourceId, quantity: 1 },
      (resp) => {
        setBusyResId(null);
        if (!resp?.ok) {
          setError(resp?.error || "Could not acquire.");
        } else if (resp.state) {
          setState(resp.state);
        }
      },
    );
  };

  const handleLaunch = () => {
    if (onSubmit) {
      onSubmit({
        type: "quest-launch",
        completedObjectives: objectivesProgress.filter((o) => o.allMet).map((o) => o.id),
        autoComplete: true,
      });
    }
  };

  /* ──────────────── Render ──────────────── */
  return (
    <div style={wrap}>
      <div style={tagStrip}>Mission</div>
      <div style={titleStyle}>{cfg.title || task?.title || "The Quest"}</div>
      {cfg.scenario ? <p style={scenarioStyle}>{cfg.scenario}</p> : null}

      {/* Objectives panel */}
      {objectivesProgress.length > 0 && (
        <div style={cardWrap}>
          <div style={cardLabel}>Objectives</div>
          {objectivesProgress.map((o) => (
            <div key={o.id || o.idx} style={{ marginTop: 8 }}>
              <div style={{ fontSize: "0.95rem", color: "#f1f5f9" }}>{o.description}</div>
              {o.lines.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>No resource requirements.</div>
              ) : (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {o.lines.map((l) => (
                    <span key={l.rid} style={{ ...invChipStyle, opacity: l.have >= l.need ? 1 : 0.65 }}>
                      {l.rid}: <strong style={{ marginLeft: 4 }}>{l.have}</strong> / {l.need}
                      {l.have >= l.need ? " ✓" : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Resource shop */}
      {resources.length > 0 && (
        <div style={cardWrap}>
          <div style={cardLabel}>Supply depot</div>
          <div style={{ fontSize: "0.78rem", color: "#cbd5e1", marginBottom: 8 }}>
            Earn coins by completing tasks, then spend them here.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {resources.map((r) => {
              const coinOpt = (r.acquisitionOptions || []).find((o) => o?.type === "coins");
              const cost = Number(coinOpt?.amount) || 0;
              const canAfford = coins >= cost;
              const have = Number(inv[r.id]) || 0;
              return (
                <div key={r.id} style={resourceRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#f1f5f9" }}>
                      {r.name || r.id}
                      {have > 0 && <span style={{ fontSize: "0.78rem", marginLeft: 6, color: "#bbf7d0" }}>×{have}</span>}
                    </div>
                    {cost > 0 ? (
                      <div style={{ fontSize: "0.72rem", color: "#cbd5e1" }}>{cost} coin{cost === 1 ? "" : "s"}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBuy(r.id)}
                    disabled={disabled || !isLive || !canAfford || busyResId === r.id}
                    style={{
                      ...buyBtn,
                      background: !canAfford ? "rgba(75,85,99,0.4)" : busyResId === r.id ? "#7c3aed88" : "#7c3aed",
                      cursor: !canAfford || busyResId === r.id ? "not-allowed" : "pointer",
                      opacity: !canAfford ? 0.55 : 1,
                    }}
                  >
                    {busyResId === r.id ? "…" : "Buy"}
                  </button>
                </div>
              );
            })}
          </div>
          {error ? <div style={errStyle}>{error}</div> : null}
        </div>
      )}

      {/* Launch button */}
      <button
        type="button"
        onClick={handleLaunch}
        disabled={disabled || !allObjectivesMet}
        style={{
          ...launchBtn,
          background: allObjectivesMet ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(75,85,99,0.4)",
          cursor: allObjectivesMet ? "pointer" : "not-allowed",
          opacity: allObjectivesMet ? 1 : 0.55,
        }}
      >
        {allObjectivesMet ? "Launch Mission →" : "Gather supplies to launch"}
      </button>

      {ranks.length > 0 && (
        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 4 }}>
          Ranks: {ranks.map((r) => r.label).join(" → ")}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "14px 14px",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};
const tagStrip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#fde68a",
  alignSelf: "flex-start",
  padding: "2px 8px",
  background: "rgba(251,191,36,0.18)",
  borderRadius: 999,
};
const titleStyle = { fontSize: "1.6rem", fontWeight: 800, color: "#f1f5f9" };
const scenarioStyle = {
  fontSize: "0.95rem",
  color: "#cbd5e1",
  lineHeight: 1.5,
  margin: 0,
};
const cardWrap = {
  padding: 12,
  background: "rgba(30,41,59,0.55)",
  border: "1px solid rgba(124,58,237,0.35)",
  borderRadius: 12,
};
const cardLabel = {
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#a78bfa",
  marginBottom: 4,
};
const invChipStyle = {
  fontSize: "0.78rem",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(34,197,94,0.12)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#bbf7d0",
  fontVariantNumeric: "tabular-nums",
};
const resourceRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 10px",
  background: "rgba(15,23,42,0.5)",
  borderRadius: 10,
};
const buyBtn = {
  padding: "6px 14px",
  fontSize: "0.85rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 8,
  color: "#fff",
  minWidth: 60,
};
const launchBtn = {
  padding: "12px 28px",
  fontSize: "1rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 14,
  color: "#fff",
  marginTop: 4,
};
const errStyle = {
  fontSize: "0.8rem",
  color: "#fca5a5",
  background: "rgba(239,68,68,0.10)",
  border: "1px solid rgba(239,68,68,0.35)",
  borderRadius: 8,
  padding: "6px 10px",
  marginTop: 8,
};
