// student-app/src/components/tasks/types/RolePlayDeckTask.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";

/**
 * RolePlayDeckTask
 * Intra-team role assignment (Mystery or Classic) + scenario role-play.
 * Not objectively scored; submit marks completion.
 */
const CONTRAST_TEXT_DARK = "#0f172a";
const CONTRAST_BG_LIGHT = "#f9fafb";
const CONTRAST_BORDER = "#d1d5db";
const ACCENT_PURPLE = "#6366f1";
const ACCENT_GREEN = "#22c55e";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default function RolePlayDeckTask({
  task,
  onSubmit,
  disabled = false,
  socket, // optional: ref with .current OR socket instance
  roomCode,
  teamId,
  memberNames = [],
}) {
  const cfg = task?.config || {};

  const fallbackCount = clamp(Number(cfg.playerCount || memberNames.length || 3) || 3, 1, 8);
  const playerCount = clamp(Number(cfg.playerCount || fallbackCount) || fallbackCount, 1, 8);

  const playerNames = useMemo(() => {
    const fromCfg = Array.isArray(cfg.playerNames) ? cfg.playerNames.filter(Boolean) : [];
    const fromMembers = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
    const base = fromCfg.length ? fromCfg : fromMembers;
    return Array.from({ length: playerCount }, (_, i) => base[i] || `Player ${i + 1}`);
  }, [cfg.playerNames, memberNames, playerCount]);

  const roles = useMemo(() => (Array.isArray(cfg.roles) ? cfg.roles : []), [cfg.roles]);
  const scenario = String(cfg.scenario || task?.prompt || "Role-play the scenario using your characters.").trim();

  const defaultMode = (cfg.mode || "choose").toString().toLowerCase();
  const [mode, setMode] = useState(
    defaultMode === "mystery" || defaultMode === "classic" ? defaultMode : null
  );

  const [currentTurn, setCurrentTurn] = useState(1); // 1-based
  const [assignedRoles, setAssignedRoles] = useState(() => Array(playerCount).fill(null));
  const [deckSpinning, setDeckSpinning] = useState(false);

  const [overlayMessage, setOverlayMessage] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  const allRolesAssigned = assignedRoles.every((r) => r != null);

  const socketEmit = (event, payload) => {
    try {
      const s = socket?.current || socket;
      s?.emit?.(event, payload);
    } catch {
      // ignore
    }
  };

  // If playerCount changes mid-render (rare), keep arrays aligned.
  useEffect(() => {
    setAssignedRoles((prev) => {
      const next = Array(playerCount).fill(null);
      for (let i = 0; i < Math.min(prev.length, next.length); i += 1) next[i] = prev[i];
      return next;
    });
    setCurrentTurn((t) => clamp(t, 1, playerCount));
  }, [playerCount]);

  const chooseMode = (chosen) => {
    const m = chosen === "mystery" ? "mystery" : "classic";
    setMode(m);
    socketEmit("roleplay:mode", { roomCode, teamId, mode: m, taskId: task?._id || task?.id || null });
  };

  const drawRole = () => {
    if (disabled || deckSpinning || !mode) return;
    if (currentTurn < 1 || currentTurn > playerCount) return;

    setDeckSpinning(true);
    socketEmit("roleplay:draw-start", { roomCode, teamId, turn: currentTurn, taskId: task?._id || task?.id || null });

    setTimeout(() => {
      const next = [...assignedRoles];

      const fallback = {
        name: playerNames[currentTurn - 1] || `Player ${currentTurn}`,
        role: "Team Member",
        characteristics: ["respectful", "truthful", "courageous"],
      };

      next[currentTurn - 1] = roles[currentTurn - 1] || fallback;

      setAssignedRoles(next);
      const done = next.every((x) => x != null);

      if (!done) setCurrentTurn((t) => (t % playerCount) + 1);

      setDeckSpinning(false);
      socketEmit("roleplay:draw-done", { roomCode, teamId, turn: currentTurn, done, taskId: task?._id || task?.id || null });
    }, 900);
  };

  const startOverlayTimer = () => {
    setOverlayTimer(10);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setOverlayMessage(null);
          setOverlayTimer(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    };
  }, []);

  const finish = () => {
    if (disabled) return;

    setOverlayMessage("✅ Role-play complete!");
    startOverlayTimer();

    onSubmit?.({
      type: task?.taskType || task?.type || "role-play-deck",
      completed: true,
      mode: mode || defaultMode || "choose",
      playerCount,
      playerNames,
      assignedRoles,
      scenario,
      rolePlayComplete: true,
    });

    socketEmit("roleplay:complete", { roomCode, teamId, taskId: task?._id || task?.id || null });
  };

  const headerBadge =
    mode === "mystery" ? "🕵️ Mystery Mode" : mode === "classic" ? "🎭 Classic Mode" : "🎴 Choose a mode";

  return (
    <div className="h-full overflow-auto" style={{ padding: 14, color: CONTRAST_TEXT_DARK }}>
      <div
        style={{
          borderRadius: 18,
          border: `1px solid ${CONTRAST_BORDER}`,
          background: "#ffffff",
          padding: 14,
          boxShadow: "0 10px 30px rgba(2,6,23,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 900 }}>🎴 Role Play Deck</div>
          <div
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${CONTRAST_BORDER}`,
              background: CONTRAST_BG_LIGHT,
              fontWeight: 800,
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
            }}
            title="Mode"
          >
            {headerBadge}
          </div>
        </div>

        {task?.prompt && (
          <div style={{ marginTop: 10, color: "#334155", fontSize: "0.98rem", lineHeight: 1.35 }}>{task.prompt}</div>
        )}

        {/* Mode Choice */}
        {!mode && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Choose a mode</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                type="button"
                onClick={() => chooseMode("mystery")}
                disabled={disabled}
                style={{
                  padding: "12px 12px",
                  borderRadius: 16,
                  border: "none",
                  background: disabled ? "#9ca3af" : ACCENT_PURPLE,
                  color: "#fff",
                  fontWeight: 900,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                🕵️ Mystery (hidden roles)
              </button>
              <button
                type="button"
                onClick={() => chooseMode("classic")}
                disabled={disabled}
                style={{
                  padding: "12px 12px",
                  borderRadius: 16,
                  border: "none",
                  background: disabled ? "#9ca3af" : ACCENT_GREEN,
                  color: "#fff",
                  fontWeight: 900,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                🎭 Classic (open roles)
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: "0.9rem", color: "#475569" }}>
              <strong>Tip:</strong> In Mystery Mode, each player should briefly hold the device while drawing their card.
            </div>
          </div>
        )}

        {/* Draw Phase */}
        {mode && !allRolesAssigned && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>
                Turn: <span style={{ color: ACCENT_PURPLE }}>Player {currentTurn}</span>
              </div>
              <div style={{ fontSize: "0.9rem", color: "#475569" }}>{playerCount} players</div>
            </div>

            <div
              style={{
                marginTop: 10,
                borderRadius: 16,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: CONTRAST_BG_LIGHT,
                padding: 12,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>How it works</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#334155", lineHeight: 1.35 }}>
                <li>Player {currentTurn} taps “Draw role card”.</li>
                <li>In Mystery mode, only that player should view the card.</li>
                <li>Repeat until everyone has a role.</li>
              </ul>
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                onClick={drawRole}
                disabled={disabled || deckSpinning}
                style={{
                  padding: "14px 18px",
                  borderRadius: 999,
                  border: "none",
                  background: disabled || deckSpinning ? "#9ca3af" : ACCENT_GREEN,
                  color: "#fff",
                  fontWeight: 1000,
                  fontSize: "1.05rem",
                  cursor: disabled ? "not-allowed" : "pointer",
                  minWidth: 220,
                }}
              >
                {deckSpinning ? "🎴 Drawing…" : "🎴 Draw role card"}
              </button>
            </div>
          </div>
        )}

        {/* Role Cards */}
        {mode && assignedRoles.some((r) => r != null) && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Role cards</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {playerNames.map((pName, i) => {
                const role = assignedRoles[i];
                const reveal = mode === "classic"; // Mystery mode hides details; relies on players remembering their card.

                return (
                  <div
                    key={`${pName}:${i}`}
                    style={{
                      borderRadius: 16,
                      border: `1px solid ${CONTRAST_BORDER}`,
                      background: "#ffffff",
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>
                        {i + 1}. {pName}
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "#64748b" }}>{role ? "Drawn" : "Waiting"}</div>
                    </div>

                    {!role && <div style={{ marginTop: 8, color: "#94a3b8" }}>Waiting to draw…</div>}

                    {role && !reveal && (
                      <div style={{ marginTop: 8, color: "#475569", fontStyle: "italic" }}>
                        Mystery Mode: keep roles hidden (each player remembers their card).
                      </div>
                    )}

                    {role && reveal && (
                      <div style={{ marginTop: 10, lineHeight: 1.35 }}>
                        <div>
                          <strong>Name:</strong> {role.name}
                        </div>
                        <div>
                          <strong>Role:</strong> {role.role}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <strong>Traits:</strong>{" "}
                          {Array.isArray(role.characteristics) && role.characteristics.length ? role.characteristics.join(", ") : "—"}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {mode === "mystery" && (
              <div style={{ marginTop: 10, fontSize: "0.9rem", color: "#475569" }}>
                <strong>Mystery mode note:</strong> The UI hides role details. Players should privately remember (or quickly note) their card.
              </div>
            )}
          </div>
        )}

        {/* Scenario */}
        {mode && allRolesAssigned && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                borderRadius: 16,
                border: `1px solid ${CONTRAST_BORDER}`,
                background: "linear-gradient(180deg, #eef2ff, #ffffff)",
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 1000, marginBottom: 8 }}>🎬 Scenario</div>
              <div style={{ fontSize: "1.05rem", lineHeight: 1.45, color: "#0f172a" }}>{scenario}</div>

              <div style={{ marginTop: 10, color: "#334155" }}>
                Role-play the scenario as a team. Try to stay in character and use the traits on your card.
              </div>

              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  onClick={finish}
                  disabled={disabled}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 999,
                    border: "none",
                    background: disabled ? "#9ca3af" : "#16a34a",
                    color: "#fff",
                    fontWeight: 1000,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  ✅ End role-play
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Post-submission overlay */}
      {overlayMessage && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.92)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            textAlign: "center",
            color: "#fff",
          }}
        >
          <div>
            <div style={{ fontSize: "2.4rem", fontWeight: 1000 }}>{overlayMessage}</div>
            <div style={{ marginTop: 18, fontSize: "1.2rem", opacity: 0.9 }}>Next in {overlayTimer}s…</div>
          </div>
        </div>
      )}
    </div>
  );
}
