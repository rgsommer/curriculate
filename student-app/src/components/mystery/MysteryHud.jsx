// student-app/src/components/mystery/MysteryHud.jsx
//
// Whodunnit HUD — mounted from StudentApp when the room has an active mystery.
// Shows clue board + suspect inbox (if this device is the assigned suspect) +
// accusation button.
//
// Anti-toxicity rules locked in (WHODUNNIT_PLAN.md §11):
//   - Suspect identity NEVER displayed for non-suspect devices.
//   - Wrong accusations don't broadcast the accused name.
//   - Accusation dialog gates by max-accusations + cooldown server-side.
import React, { useEffect, useMemo, useState } from "react";

export default function MysteryHud({ socket, roomCode, teamId, teamMembers = [], myPlayerName = null }) {
  const [enabled, setEnabled] = useState(false);
  const [themeRole, setThemeRole] = useState("spy");
  const [clues, setClues] = useState([]);
  const [iAmSuspect, setIAmSuspect] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endedSuspect, setEndedSuspect] = useState(null);
  const [showAccuse, setShowAccuse] = useState(false);
  const [accuseTarget, setAccuseTarget] = useState(null);
  const [accuseStatus, setAccuseStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accusationCount, setAccusationCount] = useState(0);
  const [purchasedClues, setPurchasedClues] = useState([]);
  const [purchaseStatus, setPurchaseStatus] = useState(null);
  const [purchaseBusy, setPurchaseBusy] = useState(false);

  useEffect(() => {
    if (!socket || !roomCode || !teamId) return;
    let cancelled = false;
    socket.emit("mystery:requestState", { roomCode }, (resp) => {
      if (cancelled || !resp?.ok) return;
      setEnabled(!!resp.state?.enabled);
      setThemeRole(resp.state?.themeRole || "spy");
      setClues(resp.state?.cluesReleased || []);
      setEnded(!!resp.state?.ended);
    });
    const onEnabled = (snap) => { setEnabled(true); setThemeRole(snap?.themeRole || "spy"); setClues(snap?.cluesReleased || []); };
    const onClue = (clue) => { setClues((cur) => [...cur, clue]); };
    const onYouAreSuspect = (payload) => {
      // Only flip if THIS device's player matches the named suspect.
      if (payload?.suspectName && typeof myPlayerName === "string" && payload.suspectName.toLowerCase() === myPlayerName.toLowerCase()) {
        setIAmSuspect(true);
      }
    };
    const onAccusationResult = (msg) => {
      if (msg?.teamId === teamId) {
        setAccusationCount((c) => c + 1);
      }
    };
    const onGameEnded = (msg) => {
      setEnded(true);
      setEndedSuspect(msg?.suspectPlayerId || null);
    };

    const onCluePurchased = (clue) => { setPurchasedClues((cur) => [...cur, clue]); };

    socket.on("mystery:enabled", onEnabled);
    socket.on("mystery:clueReleased", onClue);
    socket.on("mystery:youAreSuspect", onYouAreSuspect);
    socket.on("mystery:accusationResult", onAccusationResult);
    socket.on("mystery:gameEnded", onGameEnded);
    socket.on("mystery:cluePurchased", onCluePurchased);

    return () => {
      cancelled = true;
      socket.off("mystery:enabled", onEnabled);
      socket.off("mystery:clueReleased", onClue);
      socket.off("mystery:youAreSuspect", onYouAreSuspect);
      socket.off("mystery:accusationResult", onAccusationResult);
      socket.off("mystery:gameEnded", onGameEnded);
      socket.off("mystery:cluePurchased", onCluePurchased);
    };
  }, [socket, roomCode, teamId, myPlayerName]);

  const accusationCandidates = useMemo(() => {
    // For MVP, accusation pool = all known players from teamMembers prop.
    // A richer implementation would receive a class-wide player list from the server.
    return Array.isArray(teamMembers) ? teamMembers.filter(Boolean) : [];
  }, [teamMembers]);

  if (!enabled) return null;

  const handleAccuse = () => {
    if (!accuseTarget || busy) return;
    setBusy(true);
    setAccuseStatus(null);
    socket.emit("mystery:accuse", { roomCode, teamId, accusedPlayerId: accuseTarget }, (resp) => {
      setBusy(false);
      if (!resp?.ok) {
        setAccuseStatus(resp?.error || "Could not accuse");
        return;
      }
      if (resp.correct) {
        setAccuseStatus("Correct — case closed.");
        setShowAccuse(false);
      } else {
        setAccuseStatus("Wrong. The suspect remains at large.");
        setAccuseTarget(null);
      }
    });
  };

  return (
    <div style={wrap}>
      <div style={labelChip}>🕵 Whodunnit · {themeRole}</div>

      {iAmSuspect && !ended ? (
        <div style={suspectInbox}>
          🤫 <strong>You're the {themeRole}.</strong> Play it cool. Try to stay under the radar.
        </div>
      ) : null}

      {clues.length > 0 ? (
        <div style={clueBoard}>
          <div style={smallLabel}>Clue board (public)</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "#e2e8f0", fontSize: "0.85rem" }}>
            {clues.slice(-6).map((c, i) => (
              <li key={c.id || i} style={{ marginBottom: 4 }}>{c.text}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>No clues yet. Keep playing — they'll surface.</div>
      )}

      {purchasedClues.length > 0 && (
        <div style={{ ...clueBoard, borderColor: "rgba(34,197,94,0.4)" }}>
          <div style={{ ...smallLabel, color: "#86efac" }}>Your team's private clues</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "#bbf7d0", fontSize: "0.85rem" }}>
            {purchasedClues.map((c, i) => (
              <li key={c.id || i} style={{ marginBottom: 4 }}>🔍 {c.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Investigation purchase menu — visible while round is active */}
      {!ended && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["movement", "identity", "timing"].map((t) => (
            <button
              key={t}
              type="button"
              disabled={purchaseBusy}
              onClick={() => {
                if (!socket || purchaseBusy) return;
                setPurchaseBusy(true);
                setPurchaseStatus(null);
                socket.emit("mystery:purchaseClue", { roomCode, teamId, type: t }, (resp) => {
                  setPurchaseBusy(false);
                  if (resp?.ok && resp.clue) {
                    setPurchaseStatus(`Bought ${t} clue for ${resp.cost} pts`);
                  } else if (resp?.error) {
                    setPurchaseStatus(resp.error);
                  }
                });
              }}
              style={{
                ...accuseBtn,
                background: "rgba(124,58,237,0.18)",
                border: "1px solid #7c3aed",
                color: "#c4b5fd",
                fontSize: "0.72rem",
                padding: "4px 10px",
              }}
            >
              + {t} clue
            </button>
          ))}
        </div>
      )}
      {purchaseStatus ? (
        <div style={{ fontSize: "0.72rem", color: "#cbd5e1" }}>{purchaseStatus}</div>
      ) : null}

      {ended ? (
        <div style={endedBox}>
          {endedSuspect ? <>The {themeRole} was <strong>{endedSuspect}</strong>.</> : <>The round has ended.</>}
        </div>
      ) : (
        <>
          {!showAccuse ? (
            <button type="button" onClick={() => setShowAccuse(true)} style={accuseBtn}>
              Make an accusation
            </button>
          ) : (
            <div style={accuseDialog}>
              <div style={smallLabel}>Who is the {themeRole}?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {accusationCandidates.length === 0 ? (
                  <div style={{ fontSize: "0.78rem", color: "#fde68a" }}>
                    Once team members are known, you'll see them here.
                  </div>
                ) : (
                  accusationCandidates.map((name) => (
                    <label key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "#e2e8f0" }}>
                      <input type="radio" name="accuse" value={name} checked={accuseTarget === name} onChange={() => setAccuseTarget(name)} />
                      {name}
                    </label>
                  ))
                )}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 6 }}>
                Wrong accusations cost points. They won't broadcast who you accused.
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button type="button" onClick={handleAccuse} disabled={!accuseTarget || busy} style={{ ...accuseBtn, background: "#ef4444" }}>
                  {busy ? "…" : "Accuse"}
                </button>
                <button type="button" onClick={() => { setShowAccuse(false); setAccuseTarget(null); }} style={{ ...accuseBtn, background: "transparent", border: "1px solid #475569", color: "#cbd5e1" }}>
                  Cancel
                </button>
              </div>
              {accuseStatus ? <div style={{ fontSize: "0.8rem", color: "#fde68a", marginTop: 6 }}>{accuseStatus}</div> : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "10px 14px",
  margin: "8px 0",
  background: "linear-gradient(135deg, rgba(15,23,42,0.7), rgba(124,58,237,0.10))",
  border: "1px solid rgba(124,58,237,0.35)",
  borderRadius: 12,
  color: "#f1f5f9",
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
  alignSelf: "flex-start",
};
const smallLabel = {
  fontSize: "0.7rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "#a78bfa",
};
const clueBoard = {
  padding: "8px 10px",
  background: "rgba(30,41,59,0.6)",
  borderRadius: 10,
  border: "1px solid rgba(124,58,237,0.3)",
};
const suspectInbox = {
  padding: "8px 12px",
  borderRadius: 10,
  background: "rgba(251,191,36,0.12)",
  border: "1px solid rgba(251,191,36,0.5)",
  color: "#fde68a",
  fontSize: "0.85rem",
};
const accuseBtn = {
  padding: "6px 14px",
  fontSize: "0.82rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 8,
  background: "#7c3aed",
  color: "#fff",
  cursor: "pointer",
  alignSelf: "flex-start",
};
const accuseDialog = {
  padding: "10px 12px",
  background: "rgba(30,41,59,0.7)",
  border: "1px solid rgba(124,58,237,0.4)",
  borderRadius: 12,
};
const endedBox = {
  padding: "8px 12px",
  background: "rgba(34,197,94,0.10)",
  border: "1px solid rgba(34,197,94,0.35)",
  borderRadius: 10,
  color: "#bbf7d0",
  fontSize: "0.9rem",
};
