// student-app/src/components/tasks/types/RolePlayDeckTask.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import StepCircle from "../StepCircle";

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

  const scenario = String(
    cfg.scenario || task?.prompt || "Role-play the scenario using your characters."
  ).trim();

  const defaultMode = (cfg.mode || "choose").toString().toLowerCase();
  const [mode, setMode] = useState(
    defaultMode === "mystery" || defaultMode === "classic" ? defaultMode : null
  );

  // Turn / assignments
  const [currentTurn, setCurrentTurn] = useState(1); // 1-based
  const [assignedRoles, setAssignedRoles] = useState(() => Array(playerCount).fill(null));
  const [deckSpinning, setDeckSpinning] = useState(false);

  // Mystery-mode: explicit pass-device flow + private card reveal.
  // pass -> draw -> card -> pass (next player)
  const [mysteryStage, setMysteryStage] = useState("pass");
  const [activeCard, setActiveCard] = useState(null); // { playerIndex, role }

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

  const roleId = (r, idx) => String(r?.id || r?._id || `${r?.name || "role"}:${idx}`);

  const normalizeGender = (g) => {
    const s = String(g || "").toLowerCase().trim();
    if (s === "male" || s === "m") return "male";
    if (s === "female" || s === "f") return "female";
    // enforce only male/female
    return "male";
  };

  const normalizeRole = (raw, fallbackName) => {
    const r = raw && typeof raw === "object" ? raw : {};
    const name = String(r.name || fallbackName || "Character").trim();
    const role = String(r.role || r.job || r.title || "Team Member").trim();

    let characteristics =
      Array.isArray(r.characteristics) ? r.characteristics :
      Array.isArray(r.traits) ? r.traits :
      typeof r.characteristics === "string" ? r.characteristics.split(",") :
      typeof r.traits === "string" ? r.traits.split(",") :
      [];

    characteristics = characteristics
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 8);

    if (!characteristics.length) characteristics = ["respectful", "truthful", "courageous"];

    const gender = normalizeGender(r.gender || r.sex || "male");

    return { ...r, name, role, characteristics, gender };
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

  // If mode changes, reset the pass-device flow for mystery mode.
  useEffect(() => {
    if (mode === "mystery") setMysteryStage("pass");
    if (mode !== "mystery") setMysteryStage("pass");
    setActiveCard(null);
  }, [mode, task?._id, task?.id]);

  const chooseMode = (chosen) => {
    const m = chosen === "mystery" ? "mystery" : "classic";
    setMode(m);
    socketEmit("roleplay:mode", { roomCode, teamId, mode: m, taskId: task?._id || task?.id || null });
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

  const drawRole = () => {
    if (disabled || deckSpinning || !mode) return;
    if (currentTurn < 1 || currentTurn > playerCount) return;

    setDeckSpinning(true);
    socketEmit("roleplay:draw-start", { roomCode, teamId, turn: currentTurn, taskId: task?._id || task?.id || null });

    setTimeout(() => {
      const next = [...assignedRoles];

      const fallbackRaw = {
        name: `${playerNames[currentTurn - 1] || `Player ${currentTurn}`}`,
        role: "Team Member",
        characteristics: ["respectful", "truthful", "courageous"],
        gender: "male",
      };

      const chosenRaw = roles[currentTurn - 1] || fallbackRaw;
      const normalized = normalizeRole(chosenRaw, fallbackRaw.name);

      next[currentTurn - 1] = normalized;

      setAssignedRoles(next);

      const done = next.every((x) => x != null);

      setDeckSpinning(false);
      socketEmit("roleplay:draw-done", { roomCode, teamId, turn: currentTurn, done, taskId: task?._id || task?.id || null });

      // Mystery mode: immediately show the card to that player, then advance turn after hide.
      if (mode === "mystery") {
        setActiveCard({ playerIndex: currentTurn - 1, role: normalized });
        setMysteryStage("card");
      } else {
        // Classic mode: advance automatically.
        if (!done) setCurrentTurn((t) => (t % playerCount) + 1);
      }
    }, 900);
  };

  const goNextTurn = () => {
    setActiveCard(null);
    setMysteryStage("pass");
    setCurrentTurn((t) => {
      const next = (t % playerCount) + 1;
      return clamp(next, 1, playerCount);
    });
  };

  // ──────────────────────────────────────────────────────────────────
  // Peer-evaluation phase (tester request).  After "End role-play",
  // each player in turn secretly rates the others 1–5 stars (15s
  // timer) and the device passes around the team.
  // ──────────────────────────────────────────────────────────────────
  const PEER_EVAL_SECONDS = 15;
  // null  → not in eval; "pass" → device-pass screen for next rater;
  // "rate" → rater is rating; "done" → wraps up + auto-submit.
  const [peerEvalPhase, setPeerEvalPhase] = useState(null);
  const [peerEvalRaterIdx, setPeerEvalRaterIdx] = useState(0);
  const [peerEvalSecondsLeft, setPeerEvalSecondsLeft] = useState(PEER_EVAL_SECONDS);
  // ratings shape: { [raterIndex]: { [ratedIndex]: stars } }
  const [peerEvalRatings, setPeerEvalRatings] = useState({});

  // Hide automatically after the 15s timer + advance to next rater.
  useEffect(() => {
    if (peerEvalPhase !== "rate") return;
    if (peerEvalSecondsLeft <= 0) {
      // Move to the next rater (or finish).
      const next = peerEvalRaterIdx + 1;
      if (next >= playerCount) {
        setPeerEvalPhase("done");
      } else {
        setPeerEvalRaterIdx(next);
        setPeerEvalSecondsLeft(PEER_EVAL_SECONDS);
        setPeerEvalPhase("pass");
      }
      return;
    }
    const t = setTimeout(
      () => setPeerEvalSecondsLeft((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearTimeout(t);
  }, [peerEvalPhase, peerEvalSecondsLeft, peerEvalRaterIdx, playerCount]);

  const setPeerStar = (ratedIdx, stars) => {
    setPeerEvalRatings((prev) => {
      const cur = prev[peerEvalRaterIdx] || {};
      return {
        ...prev,
        [peerEvalRaterIdx]: { ...cur, [ratedIdx]: stars },
      };
    });
  };

  // Average per player across all rater scores.
  const averageStarsPerPlayer = useMemo(() => {
    const out = {};
    Object.entries(peerEvalRatings).forEach(([raterIdx, scores]) => {
      Object.entries(scores).forEach(([rIdx, stars]) => {
        const k = String(rIdx);
        if (!out[k]) out[k] = { sum: 0, count: 0 };
        out[k].sum += Number(stars) || 0;
        out[k].count += 1;
      });
    });
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, v.count ? v.sum / v.count : 0])
    );
  }, [peerEvalRatings]);

  // Once peerEvalPhase === "done" we wrap up and call finish().
  useEffect(() => {
    if (peerEvalPhase === "done") {
      // small delay so the player sees the "All done — sending results" UI
      const t = setTimeout(() => doFinishWithRatings(), 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerEvalPhase]);

  const doFinishWithRatings = () => {
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
      peerEvaluations: peerEvalRatings,
      averageStarsPerPlayer,
    });
    socketEmit("roleplay:complete", { roomCode, teamId, taskId: task?._id || task?.id || null });
  };

  const finish = () => {
    if (disabled) return;
    if (playerCount < 2) {
      // Solo / unknown roster — skip the peer-eval phase, just submit.
      doFinishWithRatings();
      return;
    }
    setPeerEvalRaterIdx(0);
    setPeerEvalSecondsLeft(PEER_EVAL_SECONDS);
    setPeerEvalRatings({});
    setPeerEvalPhase("pass");
  };

  const headerBadge =
    mode === "mystery" ? "🕵️ Mystery Mode" : mode === "classic" ? "🎭 Classic Mode" : "🎴 Choose a mode";

  const currentPlayerLabel = playerNames[currentTurn - 1] || `Player ${currentTurn}`;

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
          <div style={{ marginTop: 10, color: "#334155", fontSize: "0.98rem", lineHeight: 1.35 }}>
            {task.prompt}
          </div>
        )}

        {/* Hype screen — single intro that explains the task and gets students excited */}
        {!mode && (
          <div
            style={{
              marginTop: 12,
              borderRadius: 18,
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)",
              padding: "20px 16px",
              color: "#fff",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "2.2rem", marginBottom: 6 }}>🎭</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 1000, marginBottom: 6 }}>
              Time to become someone else!
            </div>
            <div style={{ fontSize: "1rem", lineHeight: 1.5, opacity: 0.92, marginBottom: 16, maxWidth: 500, margin: "0 auto 16px" }}>
              Each of you will draw a secret character card with a unique role and personality.
              Then you'll act out a scenario together — staying in character the whole time!
            </div>

            <div
              style={{
                display: "inline-flex",
                flexDirection: "column",
                gap: 6,
                background: "rgba(255,255,255,0.15)",
                borderRadius: 14,
                padding: "10px 18px",
                textAlign: "left",
                fontSize: "0.95rem",
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              <div>🎴 Draw your secret role card</div>
              <div>🎬 Read the scenario together</div>
              <div>🗣️ Act it out — stay in character!</div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => chooseMode("mystery")}
                disabled={disabled}
                style={{
                  padding: "14px 28px",
                  borderRadius: 999,
                  border: "2px solid rgba(255,255,255,0.5)",
                  background: "rgba(255,255,255,0.2)",
                  color: "#fff",
                  fontWeight: 1000,
                  fontSize: "1.1rem",
                  cursor: disabled ? "not-allowed" : "pointer",
                  backdropFilter: "blur(4px)",
                }}
              >
                🕵️ Mystery Mode
              </button>
              <button
                type="button"
                onClick={() => chooseMode("classic")}
                disabled={disabled}
                style={{
                  padding: "14px 28px",
                  borderRadius: 999,
                  border: "2px solid rgba(255,255,255,0.3)",
                  background: "rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.85)",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                🎭 Classic Mode
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: "0.82rem", opacity: 0.7 }}>
              Mystery = secret roles · Classic = everyone sees all roles
            </div>
          </div>
        )}

        {/* Draw Phase */}
        {mode && !allRolesAssigned && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>
                Turn:{" "}
                <span style={{ color: ACCENT_PURPLE }}>
                  Player {currentTurn} ({currentPlayerLabel})
                </span>
              </div>
              <div style={{ fontSize: "0.9rem", color: "#475569" }}>{playerCount} players</div>
            </div>

            {/* Mystery mode: explicit pass-device interstitial before draw */}
            {mode === "mystery" && mysteryStage === "pass" && (
              <div
                style={{
                  marginTop: 12,
                  padding: 14,
                  borderRadius: 18,
                  border: `1px solid ${CONTRAST_BORDER}`,
                  background: "linear-gradient(180deg, #eef2ff, #ffffff)",
                }}
              >
                <div style={{ fontWeight: 1000, fontSize: "1.1rem" }}>📲 Pass the device</div>
                <div style={{ marginTop: 6, color: "#334155", lineHeight: 1.35 }}>
                  Give the device to <strong>{currentPlayerLabel}</strong> (Player {currentTurn}). They will draw and privately view their role card.
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      // Tester reported needing to tap Draw twice each turn.
                      // Cause: two-button gate (this "I am X" button only set
                      // mysteryStage to "draw"; you then had to tap a second
                      // "Draw role card" button).  Now the same tap also
                      // triggers drawRole on the next tick — single tap to
                      // draw your card.
                      setMysteryStage("draw");
                      setTimeout(() => drawRole(), 0);
                    }}
                    disabled={disabled || deckSpinning}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 999,
                      border: "none",
                      background: disabled || deckSpinning ? "#9ca3af" : ACCENT_PURPLE,
                      color: "#fff",
                      fontWeight: 1000,
                      cursor: disabled || deckSpinning ? "not-allowed" : "pointer",
                      minWidth: 260,
                    }}
                  >
                    {deckSpinning ? "🎴 Drawing…" : `I am ${currentPlayerLabel} — show my card`}
                  </button>
                </div>
                <div style={{ marginTop: 10, fontSize: "0.9rem", color: "#64748b" }}>
                  (After viewing, tap <strong>Hide</strong> to keep roles secret.)
                </div>
              </div>
            )}

            {/* Standalone Draw Card button — kept for classic mode and as a
                fallback if mystery mode is already in the "draw" stage. */}
            {(mode === "classic" || (mode === "mystery" && mysteryStage === "draw")) && (
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
                    cursor: disabled || deckSpinning ? "not-allowed" : "pointer",
                    minWidth: 220,
                  }}
                >
                  {deckSpinning ? "🎴 Drawing…" : "🎴 Draw role card"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Role Cards Summary (always visible once any draws have happened) */}
        {mode && assignedRoles.some((r) => r != null) && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Role cards</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {playerNames.map((pName, i) => {
                const role = assignedRoles[i];
                const reveal = mode === "classic"; // Classic mode shows details

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
                      <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
                        {role ? "Drawn" : "Waiting"}
                      </div>
                    </div>

                    {!role && <div style={{ marginTop: 8, color: "#94a3b8" }}>Waiting to draw…</div>}

                    {role && !reveal && (
                      <div style={{ marginTop: 8, color: "#475569", fontStyle: "italic" }}>
                        Mystery Mode: role details are hidden on-screen.
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
                        <div>
                          <strong>Gender:</strong> {normalizeGender(role.gender)}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <strong>Traits:</strong>{" "}
                          {Array.isArray(role.characteristics) && role.characteristics.length
                            ? role.characteristics.join(", ")
                            : "—"}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mystery mode hint is already clear from the pass-device interstitial */}
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

              {/* Clarify it's a spoken/acted task — tester (solo) expected a
                  text box: "fun concept but nowhere to record what was going on". */}
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(59,130,246,0.08)",
                  border: "1px solid rgba(59,130,246,0.25)",
                  color: "#334155",
                  fontSize: "0.85rem",
                  lineHeight: 1.4,
                }}
              >
                🗣️ This one is <b>spoken / acted out loud</b> — there's nothing to
                type. Perform the scene with your team, then tap <b>End role-play</b>.
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

      {/* Mystery mode: private card overlay (presented right after draw) */}
      {mode === "mystery" && mysteryStage === "card" && activeCard?.role && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.92)",
            zIndex: 2100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            style={{
              width: "min(760px, 92vw)",
              borderRadius: 22,
              background: "linear-gradient(180deg, #ffffff, #f8fafc)",
              border: "1px solid rgba(226,232,240,1)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
              padding: 16,
              color: "#0f172a",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 1000, fontSize: "1.25rem" }}>
                  🎴 Your role card
                </div>
                <div style={{ marginTop: 4, color: "#475569", fontWeight: 800 }}>
                  {playerNames[activeCard.playerIndex] || `Player ${activeCard.playerIndex + 1}`} — keep this secret.
                </div>
              </div>

              <div style={{ padding: "6px 10px", borderRadius: 999, background: "#eef2ff", border: "1px solid rgba(199,210,254,1)", fontWeight: 1000 }}>
                Mystery
              </div>
            </div>

            <div style={{ marginTop: 14, borderRadius: 18, border: "1px solid rgba(226,232,240,1)", background: "#ffffff", padding: 14 }}>
              <div style={{ fontSize: "1.15rem", fontWeight: 1000 }}>
                {activeCard.role.name}
              </div>
              <div style={{ marginTop: 6, fontSize: "1.02rem", color: "#334155" }}>
                <strong>Role:</strong> {activeCard.role.role}
              </div>
              <div style={{ marginTop: 6, fontSize: "1.02rem", color: "#334155" }}>
                <strong>Gender:</strong> {normalizeGender(activeCard.role.gender)}
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 1000, marginBottom: 6 }}>Traits</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(Array.isArray(activeCard.role.characteristics) ? activeCard.role.characteristics : [])
                    .slice(0, 8)
                    .map((tr, idx) => (
                      <span
                        key={`${roleId(activeCard.role, 0)}:${idx}`}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(226,232,240,1)",
                          background: "#f1f5f9",
                          fontWeight: 900,
                          color: "#0f172a",
                          fontSize: "0.95rem",
                        }}
                      >
                        {String(tr)}
                      </span>
                    ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ color: "#64748b", fontWeight: 800 }}>
                When you're ready, tap <strong>Hide</strong> and pass the device to the next player.
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    // Hide the card and move on.
                    goNextTurn();
                  }}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 999,
                    border: "none",
                    background: "#0ea5e9",
                    color: "#fff",
                    fontWeight: 1000,
                    cursor: "pointer",
                  }}
                >
                  Hide & Continue
                </button>

                <button
                  type="button"
                  onClick={() => {
                    // Dismiss without advancing (useful if the player needs to re-check briefly)
                    setMysteryStage("draw");
                    setActiveCard(null);
                  }}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 999,
                    border: "1px solid rgba(226,232,240,1)",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 1000,
                    cursor: "pointer",
                  }}
                  title="Dismiss the card overlay without advancing to the next player."
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Peer-evaluation phase ────────────────────────────────────
          Tester-requested: after the role-play wraps, each player in
          turn rates the others 1–5 stars in 15s, then passes the
          device.  Auto-advances to the next rater when the timer
          hits 0 OR when the rater taps Done. */}
      {peerEvalPhase && (
        <div
          style={{
            position: "fixed", inset: 0,
            background: "rgba(2,6,23,0.92)",
            zIndex: 2200,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            style={{
              width: "min(560px, 92vw)",
              borderRadius: 22,
              background: "linear-gradient(180deg, #ffffff, #f8fafc)",
              border: "1px solid rgba(226,232,240,1)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
              padding: 22,
              color: "#0f172a",
              textAlign: "center",
            }}
          >
            {peerEvalPhase === "pass" && (
              <>
                <div style={{ fontSize: "1.6rem", fontWeight: 1000 }}>
                  📲 Pass the device
                </div>
                <div style={{ marginTop: 8, fontSize: "1.05rem", color: "#475569", fontWeight: 800 }}>
                  Hand it to <span style={{ color: "#7c3aed" }}>{playerNames[peerEvalRaterIdx] || `Player ${peerEvalRaterIdx + 1}`}</span>.
                </div>
                <div style={{ marginTop: 4, fontSize: "0.95rem", color: "#64748b" }}>
                  Rate the others 1–5 stars on their acting in the role-play. Auto-hides after 15s.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPeerEvalSecondsLeft(PEER_EVAL_SECONDS);
                    setPeerEvalPhase("rate");
                  }}
                  style={{
                    marginTop: 18,
                    padding: "12px 18px",
                    borderRadius: 999,
                    border: "none",
                    background: "#7c3aed",
                    color: "#fff",
                    fontWeight: 1000,
                    cursor: "pointer",
                    minWidth: 220,
                  }}
                >
                  Start my 15s
                </button>
              </>
            )}

            {peerEvalPhase === "rate" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 1000 }}>
                    {playerNames[peerEvalRaterIdx] || `Player ${peerEvalRaterIdx + 1}`} rates the others
                  </div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 1000, color: peerEvalSecondsLeft <= 5 ? "#dc2626" : "#0f172a" }}>
                    {peerEvalSecondsLeft}s
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {playerNames.map((name, idx) => {
                    if (idx === peerEvalRaterIdx) return null;
                    const stars = peerEvalRatings[peerEvalRaterIdx]?.[idx] || 0;
                    return (
                      <div
                        key={idx}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between", gap: 10,
                          padding: "10px 12px",
                          borderRadius: 12,
                          background: "#f1f5f9",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>{name}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setPeerStar(idx, n)}
                              style={{
                                width: 32, height: 32,
                                borderRadius: 8,
                                border: "1px solid rgba(15,23,42,0.18)",
                                background: stars >= n ? "#fbbf24" : "#fff",
                                fontWeight: 1000,
                                fontSize: 14,
                                cursor: "pointer",
                                color: stars >= n ? "#7c2d12" : "#94a3b8",
                              }}
                              aria-label={`Give ${name} ${n} stars`}
                            >
                              {stars >= n ? "★" : "☆"}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // Done early — collapse the timer to 0 so the
                    // existing effect rolls us to the next rater.
                    setPeerEvalSecondsLeft(0);
                  }}
                  style={{
                    marginTop: 18,
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: "1px solid rgba(15,23,42,0.18)",
                    background: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  I'm done — pass it on ▶
                </button>
              </>
            )}

            {peerEvalPhase === "done" && (
              <div>
                <div style={{ fontSize: "1.6rem", fontWeight: 1000 }}>✨ All ratings in</div>
                <div style={{ marginTop: 8, fontSize: "0.95rem", color: "#64748b" }}>
                  Sending the team's results…
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
