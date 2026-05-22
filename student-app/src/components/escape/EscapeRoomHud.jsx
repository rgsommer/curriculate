// student-app/src/components/escape/EscapeRoomHud.jsx
//
// Read-only Escape Room HUD. Mounted from StudentApp when the active room's
// taskset has `escapeRoomConfig`. Subscribes to `escape:stateUpdated`.
//
// Shows: keys earned, fragments earned, locks opened, completion progress.
// FinalPuzzle interaction lives in EscapeRoomFinalPuzzle.jsx (mounted by
// TaskRunner when the active task is the "escape:final" type, or inline below
// when the final lock is reachable).
import React, { useEffect, useState } from "react";
import FinalPuzzle from "./FinalPuzzle.jsx";

export default function EscapeRoomHud({ socket, roomCode, teamId, enabled = true, tasksetConfig = null }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!enabled || !socket || !roomCode || !teamId) return;
    let cancelled = false;
    socket.emit("escape:requestState", { roomCode, teamId }, (resp) => {
      if (!cancelled && resp?.ok) setState(resp.state || null);
    });
    const onUpdate = (s) => { if (!cancelled && s) setState(s); };
    socket.on("escape:stateUpdated", onUpdate);
    return () => { cancelled = true; socket.off("escape:stateUpdated", onUpdate); };
  }, [enabled, socket, roomCode, teamId]);

  if (!enabled || !state) return null;

  const keys = state.keysEarned || [];
  const fragments = state.fragmentsEarned || [];
  const opened = state.locksOpened || [];
  const totalLocks = Array.isArray(tasksetConfig?.locks) ? tasksetConfig.locks.length : null;
  const completed = !!state.completedAt;

  return (
    <div style={wrap}>
      <div style={labelChip}>{completed ? "🎉 Escaped" : "🔐 Escape Room"}</div>

      {keys.length > 0 && (
        <div style={chipGroup}>
          {keys.slice(0, 6).map((k) => (
            <span key={k} style={keyChip}>🗝 {k}</span>
          ))}
          {keys.length > 6 ? <span style={{ ...keyChip, opacity: 0.7 }}>+{keys.length - 6}</span> : null}
        </div>
      )}

      {fragments.length > 0 && (
        <div style={chipGroup}>
          {fragments.slice(0, 6).map((f) => (
            <span key={f} style={fragmentChip}>✦ {f}</span>
          ))}
          {fragments.length > 6 ? <span style={{ ...fragmentChip, opacity: 0.7 }}>+{fragments.length - 6}</span> : null}
        </div>
      )}

      {totalLocks !== null && (
        <div style={progressLine}>
          Locks: <strong style={{ color: "#fde68a" }}>{opened.length}</strong> / {totalLocks}
        </div>
      )}

      {/* Final-lock synthesis puzzle — surfaced when the final lock is in `locks[]`
          and the team has met its `requires` (the engine doesn't auto-open final
          locks that have a synthesisAnswer — those wait for an explicit attemptUnlock). */}
      {(() => {
        const locks = Array.isArray(tasksetConfig?.locks) ? tasksetConfig.locks : [];
        const fragments = Array.isArray(tasksetConfig?.fragments) ? tasksetConfig.fragments : [];
        const finalLock = locks.find((l) => l?.unlocks?.roomCompleted);
        if (!finalLock || opened.includes(finalLock.id)) return null;

        // Check requires
        const keysHave = new Set(keys);
        const fragHave = new Set(fragments.map((f) => f.id).filter((fid) => fragments.find((ff) => ff.id === fid)));  // all fragments
        const req = finalLock.requires || {};
        const keysOk = !Array.isArray(req.keys) || req.keys.every((k) => keysHave.has(k));
        const fragsOk = !Array.isArray(req.fragments) || req.fragments.every((f) => state.fragmentsEarned?.includes(f));
        if (!keysOk || !fragsOk) return null;

        return (
          <FinalPuzzle
            socket={socket}
            roomCode={roomCode}
            teamId={teamId}
            lock={finalLock}
            fragmentsConfig={fragments}
            state={state}
          />
        );
      })()}
    </div>
  );
}

const wrap = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  padding: "8px 14px",
  margin: "8px 0",
  background: "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(124,58,237,0.12))",
  border: "1px solid rgba(251,191,36,0.35)",
  borderRadius: 12,
  color: "#f1f5f9",
  fontSize: "0.9rem",
};
const labelChip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#fde68a",
  padding: "2px 8px",
  background: "rgba(251,191,36,0.16)",
  borderRadius: 999,
};
const chipGroup = { display: "flex", gap: 6, flexWrap: "wrap" };
const keyChip = {
  fontSize: "0.78rem",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(251,191,36,0.14)",
  border: "1px solid rgba(251,191,36,0.35)",
  color: "#fde68a",
};
const fragmentChip = {
  fontSize: "0.78rem",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(124,58,237,0.14)",
  border: "1px solid rgba(124,58,237,0.35)",
  color: "#c4b5fd",
};
const progressLine = { fontSize: "0.78rem", color: "#cbd5e1" };
