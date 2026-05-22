// student-app/src/components/escape/FinalPuzzle.jsx
//
// The synthesis puzzle for the final lock of an Escape Room. Switches on
// lock.type to render one of three interaction modes (ESCAPE_ROOM_PLAN.md §6).
// Submits a `submission` string to the server via `escape:attemptUnlock`; the
// server has the canonical answer and validates.
//
// Final-puzzle types:
//   - "password" / "cipher-digit": PIN-style entry, server-validated string
//   - "image-tile":                drag/tap-to-place tiles into a grid
//   - "cipher-wheel":              rotational alignment of N rings
//
// Note: fragment revealValues are NOT shipped to the client unless the team
// has earned them (the engine emits them via escape:requestState). The puzzle
// uses whatever's in `state.fragmentsEarned` plus `tasksetConfig.fragments`.

import React, { useEffect, useMemo, useState } from "react";

export default function FinalPuzzle({ socket, roomCode, teamId, lock, fragmentsConfig = [], state = null, onSolved }) {
  const [submission, setSubmission] = useState("");
  const [tilePlacement, setTilePlacement] = useState({});       // gridIdx → fragmentId
  const [wheelRings, setWheelRings] = useState([]);             // ring index → rotation (0-360)
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [solved, setSolved] = useState(false);

  const lockType = lock?.type || "password";

  // ── Earned fragments + lookup ──
  const earnedFragmentIds = new Set((state?.fragmentsEarned || []).map(String));
  const earnedFragments = fragmentsConfig.filter((f) => earnedFragmentIds.has(f.id));

  /* ──────────────── Submission paths ──────────────── */
  const submitToServer = (value) => {
    if (!socket || !roomCode || !teamId || !lock?.id || busy) return;
    setBusy(true);
    setFeedback(null);
    socket.emit("escape:attemptUnlock", { roomCode, teamId, lockId: lock.id, submission: value }, (resp) => {
      setBusy(false);
      if (resp?.ok) {
        setSolved(true);
        setFeedback("Unlocked!");
        if (onSolved) onSolved(resp);
      } else {
        setFeedback(resp?.error || "Wrong");
      }
    });
  };

  const handlePasswordSubmit = () => submitToServer(submission.trim());

  /* ── Image-tile assembly ──
     Grid is rendered as an NxN. Each earned image-tile fragment carries `gridPos: { row, col }`.
     Validation: every earned tile is placed in the grid slot matching its gridPos.
     Submission string = JSON of placement (server validates synthesis client-side here for MVP). */
  const tileFragments = earnedFragments.filter((f) => f.type === "image-tile");
  const gridSide = Math.ceil(Math.sqrt(tileFragments.length || 1));

  useEffect(() => {
    if (lockType !== "image-tile") return;
    // Auto-mark solved when every tile sits in its correct grid slot
    if (tileFragments.length === 0) return;
    const correct = tileFragments.every((f) => {
      const targetIdx = (Number(f.gridPos?.row) || 0) * gridSide + (Number(f.gridPos?.col) || 0);
      return tilePlacement[targetIdx] === f.id;
    });
    if (correct && !solved) {
      // Client-side trigger — but server still validates via attemptUnlock with a placement payload
      submitToServer(JSON.stringify({ placement: tilePlacement }));
    }
  }, [tilePlacement, tileFragments, gridSide, lockType, solved]);

  /* ── Cipher-wheel ──
     Each cipher-wheel-ring fragment has a `correctAngle` (in degrees) and a `position` (ring index).
     Submission = comma-separated angles in ring order. */
  const wheelFragments = earnedFragments
    .filter((f) => f.type === "cipher-wheel-ring")
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

  useEffect(() => {
    if (lockType === "cipher-wheel" && wheelRings.length !== wheelFragments.length) {
      setWheelRings(new Array(wheelFragments.length).fill(0));
    }
  }, [lockType, wheelFragments.length, wheelRings.length]);

  const rotateRing = (i, delta) => {
    setWheelRings((cur) => {
      const next = cur.slice();
      next[i] = (((next[i] || 0) + delta) % 360 + 360) % 360;
      return next;
    });
  };

  const handleWheelSubmit = () => submitToServer(wheelRings.join(","));

  /* ──────────────── Render ──────────────── */
  if (solved) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: "3rem" }}>🔓</div>
        <div style={titleStyle}>{lock?.unlocks?.roomCompleted ? "You escaped!" : "Unlocked"}</div>
        {lock?.unlocks?.roomCompleted ? (
          <div style={{ fontSize: "0.9rem", color: "#bbf7d0" }}>The vault swings open. The room is yours.</div>
        ) : null}
      </div>
    );
  }

  if (lockType === "image-tile" && tileFragments.length > 0) {
    return (
      <div style={wrap}>
        <div style={titleStyle}>{lock?.title || "Reassemble the image"}</div>
        {lock?.narrativeText ? <p style={narrative}>{lock.narrativeText}</p> : null}

        {/* Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${gridSide}, 1fr)`,
          gap: 4,
          maxWidth: 320,
          alignSelf: "center",
        }}>
          {Array.from({ length: gridSide * gridSide }).map((_, idx) => {
            const occupant = tilePlacement[idx];
            const frag = tileFragments.find((f) => f.id === occupant);
            return (
              <div key={idx} style={{
                ...tileSlot,
                background: frag ? "rgba(124,58,237,0.25)" : "rgba(15,23,42,0.6)",
                border: frag ? "1px solid #7c3aed" : "1px dashed #475569",
              }}>
                {frag ? (
                  <button
                    type="button"
                    onClick={() => setTilePlacement((cur) => { const n = { ...cur }; delete n[idx]; return n; })}
                    style={tileBtn}
                    title="Remove"
                  >
                    {frag.assetUrl ? <img src={frag.assetUrl} alt="" style={{ width: "100%", borderRadius: 4 }} /> : `T${frag.position ?? frag.id}`}
                  </button>
                ) : (
                  <div style={{ fontSize: "0.65rem", color: "#64748b" }}>{idx + 1}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Tile tray — unplaced earned tiles */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
          {tileFragments
            .filter((f) => !Object.values(tilePlacement).includes(f.id))
            .map((f) => {
              // Find first empty grid slot to place into on click
              const emptySlot = Array.from({ length: gridSide * gridSide }).findIndex((_, idx) => !tilePlacement[idx]);
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={emptySlot < 0}
                  onClick={() => setTilePlacement((cur) => ({ ...cur, [emptySlot]: f.id }))}
                  style={trayTile}
                >
                  {f.assetUrl ? <img src={f.assetUrl} alt="" style={{ width: 40, borderRadius: 4 }} /> : `T${f.position ?? f.id}`}
                </button>
              );
            })}
        </div>

        {feedback ? <div style={feedbackStyle}>{feedback}</div> : null}
      </div>
    );
  }

  if (lockType === "cipher-wheel" && wheelFragments.length > 0) {
    return (
      <div style={wrap}>
        <div style={titleStyle}>{lock?.title || "Align the wheel"}</div>
        {lock?.narrativeText ? <p style={narrative}>{lock.narrativeText}</p> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "center" }}>
          {wheelFragments.map((f, i) => (
            <div key={f.id} style={ringRow}>
              <div style={{ fontSize: "0.8rem", color: "#cbd5e1", minWidth: 60 }}>Ring {i + 1}</div>
              <button type="button" onClick={() => rotateRing(i, -30)} style={rotBtn}>← 30°</button>
              <div style={{
                display: "inline-block",
                minWidth: 50,
                textAlign: "center",
                fontFamily: "monospace",
                color: "#fde68a",
                fontWeight: 700,
                padding: "4px 8px",
                background: "rgba(251,191,36,0.10)",
                border: "1px solid rgba(251,191,36,0.35)",
                borderRadius: 6,
              }}>{wheelRings[i] || 0}°</div>
              <button type="button" onClick={() => rotateRing(i, 30)} style={rotBtn}>30° →</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={handleWheelSubmit} disabled={busy} style={submitBtn}>
          {busy ? "Trying…" : "Submit alignment"}
        </button>
        {feedback ? <div style={feedbackStyle}>{feedback}</div> : null}
      </div>
    );
  }

  // password / cipher-digit / default
  return (
    <div style={wrap}>
      <div style={titleStyle}>{lock?.title || "Enter the code"}</div>
      {lock?.narrativeText ? <p style={narrative}>{lock.narrativeText}</p> : null}
      {lock?.hint ? <div style={hintBox}>💡 {lock.hint}</div> : null}

      {/* If lock.type is "cipher-digit", show earned digits inline as readable hints */}
      {(lockType === "cipher-digit" || lockType === "password") && earnedFragments.some((f) => f.type === "cipher-digit") ? (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 6 }}>
          {earnedFragments
            .filter((f) => f.type === "cipher-digit")
            .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
            .map((f) => (
              <span key={f.id} style={digitChip}>{f.revealValue ?? "?"}</span>
            ))}
        </div>
      ) : null}

      <input
        type="text"
        value={submission}
        onChange={(e) => setSubmission(e.target.value)}
        placeholder="Enter the code…"
        style={passwordInput}
      />
      <button type="button" onClick={handlePasswordSubmit} disabled={busy || !submission.trim()} style={submitBtn}>
        {busy ? "Trying…" : "Submit"}
      </button>
      {feedback ? <div style={feedbackStyle}>{feedback}</div> : null}
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "14px 14px",
  background: "linear-gradient(135deg, rgba(251,191,36,0.10), rgba(124,58,237,0.10))",
  border: "1px solid rgba(251,191,36,0.4)",
  borderRadius: 12,
  alignItems: "stretch",
};
const titleStyle = { fontSize: "1.2rem", fontWeight: 800, color: "#fde68a", textAlign: "center" };
const narrative = { fontSize: "0.85rem", color: "#cbd5e1", fontStyle: "italic", textAlign: "center", margin: 0 };
const hintBox = {
  fontSize: "0.85rem",
  color: "#fbbf24",
  background: "rgba(251,191,36,0.10)",
  border: "1px solid rgba(251,191,36,0.35)",
  borderRadius: 8,
  padding: "6px 10px",
};
const passwordInput = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "1.05rem",
  borderRadius: 10,
  border: "1px solid #475569",
  background: "rgba(15,23,42,0.6)",
  color: "#f1f5f9",
  outline: "none",
  fontFamily: "monospace",
  letterSpacing: 2,
  textAlign: "center",
};
const digitChip = {
  display: "inline-block",
  minWidth: 32,
  padding: "4px 6px",
  background: "rgba(251,191,36,0.12)",
  border: "1px solid rgba(251,191,36,0.4)",
  borderRadius: 6,
  fontFamily: "monospace",
  fontSize: "1.2rem",
  fontWeight: 700,
  color: "#fde68a",
  textAlign: "center",
};
const submitBtn = {
  padding: "10px 24px",
  fontSize: "0.95rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 10,
  background: "linear-gradient(135deg, #fbbf24, #d97706)",
  color: "#1f2937",
  cursor: "pointer",
  alignSelf: "center",
};
const feedbackStyle = {
  fontSize: "0.85rem",
  color: "#fca5a5",
  textAlign: "center",
};
const tileSlot = {
  aspectRatio: "1",
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
};
const tileBtn = {
  width: "100%",
  height: "100%",
  background: "transparent",
  border: "none",
  color: "#fde68a",
  cursor: "pointer",
  fontWeight: 700,
};
const trayTile = {
  padding: "6px 10px",
  borderRadius: 6,
  background: "rgba(251,191,36,0.18)",
  border: "1px solid rgba(251,191,36,0.4)",
  color: "#fde68a",
  cursor: "pointer",
  fontWeight: 600,
};
const ringRow = { display: "flex", alignItems: "center", gap: 8 };
const rotBtn = {
  padding: "4px 10px",
  fontSize: "0.78rem",
  fontWeight: 600,
  borderRadius: 6,
  background: "rgba(124,58,237,0.18)",
  border: "1px solid rgba(124,58,237,0.4)",
  color: "#c4b5fd",
  cursor: "pointer",
};
