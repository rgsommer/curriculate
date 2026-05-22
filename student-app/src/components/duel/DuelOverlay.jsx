// student-app/src/components/duel/DuelOverlay.jsx
//
// Full-screen duel UI. Mounted from StudentApp. Subscribes to the duel:*
// socket family and only renders an interactive challenge when this device's
// player is one of the two duelists. Other devices in the room see a
// spectator countdown + result reveal.
//
// Flow:
//   - `duel:announced` (room-wide): show 3-2-1 countdown overlay for everyone
//   - `duel:dispatched` (team-channel, contains the player name): if our player
//     matches `forPlayer`, switch to the interactive question
//   - `duel:result` (room-wide): replace overlay with the result celebration
//
// All sockets ack — wrong submits return `{ correct: false }` and we let the
// duelist try again until either they win, the opponent wins, or it times out.
import React, { useEffect, useMemo, useRef, useState } from "react";

const PHASE = {
  IDLE:       "idle",
  COUNTDOWN:  "countdown",
  ACTIVE:     "active",      // I'm a duelist; question shown
  SPECTATING: "spectating",  // I'm in the room but not picked
  RESULT:     "result",
};

export default function DuelOverlay({ socket, roomCode, teamId, myPlayerName }) {
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [announcement, setAnnouncement] = useState(null);  // { teamNames, players, startsInMs }
  const [dispatched, setDispatched] = useState(null);      // { question, startsAt, deadlineAt }
  const [result, setResult] = useState(null);
  const [submission, setSubmission] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!socket) return undefined;
    const onAnnounced = (msg) => {
      setAnnouncement(msg);
      setResult(null);
      setDispatched(null);
      setSubmission("");
      setWrong(false);
      const isMyDuel = Array.isArray(msg?.teamIds) && msg.teamIds.includes(teamId);
      setPhase(isMyDuel ? PHASE.COUNTDOWN : PHASE.SPECTATING);
    };
    const onDispatched = (msg) => {
      setDispatched(msg);
      const amIDuelist = typeof myPlayerName === "string" && msg?.forPlayer && msg.forPlayer.toLowerCase() === myPlayerName.toLowerCase();
      // Switch to ACTIVE for the duelist; everyone else on the team stays in COUNTDOWN/SPECTATING.
      if (amIDuelist) setPhase(PHASE.ACTIVE);
    };
    const onResult = (msg) => {
      setResult(msg);
      setPhase(PHASE.RESULT);
    };
    socket.on("duel:announced", onAnnounced);
    socket.on("duel:dispatched", onDispatched);
    socket.on("duel:result", onResult);
    return () => {
      socket.off("duel:announced", onAnnounced);
      socket.off("duel:dispatched", onDispatched);
      socket.off("duel:result", onResult);
    };
  }, [socket, teamId, myPlayerName]);

  // Tick the clock during countdown / active phases
  useEffect(() => {
    if (phase !== PHASE.COUNTDOWN && phase !== PHASE.ACTIVE && phase !== PHASE.SPECTATING) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Auto-dismiss result after 6s
  useEffect(() => {
    if (phase !== PHASE.RESULT) return undefined;
    const id = setTimeout(() => setPhase(PHASE.IDLE), 6000);
    return () => clearTimeout(id);
  }, [phase]);

  const handleSubmit = () => {
    if (!socket || !submission.trim() || busy) return;
    setBusy(true);
    setWrong(false);
    socket.emit("duel:submit", { roomCode, teamId, playerName: myPlayerName, value: submission.trim() }, (resp) => {
      setBusy(false);
      if (resp?.ok && resp.correct === false) {
        setWrong(true);
        setSubmission("");
      }
      // Win/lose results arrive via duel:result broadcast — no local action needed
    });
  };

  if (phase === PHASE.IDLE) return null;

  const startsInSec = announcement ? Math.max(0, Math.ceil((announcement.startsInMs || 0 + (announcement._t || 0) - 0) / 1000)) : 0;
  const countdownLeft = announcement?.startsAt ? Math.max(0, Math.ceil((announcement.startsAt - nowMs) / 1000)) : 0;
  const deadlineSec = dispatched?.deadlineAt ? Math.max(0, Math.ceil((dispatched.deadlineAt - nowMs) / 1000)) : null;

  return (
    <div style={overlay}>
      {phase === PHASE.COUNTDOWN && announcement && (
        <div style={modalCenter}>
          <div style={duelLabel}>⚔️ DUEL</div>
          <div style={vsLine}>
            <strong>{announcement.teamNames?.[0]}</strong>
            <span style={{ opacity: 0.6, margin: "0 14px" }}>vs</span>
            <strong>{announcement.teamNames?.[1]}</strong>
          </div>
          <div style={{ fontSize: "0.9rem", color: "#cbd5e1", marginTop: 4 }}>
            {announcement.players?.[0]} vs {announcement.players?.[1]}
          </div>
          <div style={countdownNumber}>
            {Math.max(1, countdownLeft) || "GO"}
          </div>
        </div>
      )}

      {phase === PHASE.SPECTATING && (
        <div style={modalCenter}>
          <div style={duelLabel}>⚔️ DUEL IN PROGRESS</div>
          <div style={vsLine}>
            <strong>{announcement?.teamNames?.[0]}</strong>
            <span style={{ opacity: 0.6, margin: "0 14px" }}>vs</span>
            <strong>{announcement?.teamNames?.[1]}</strong>
          </div>
          <div style={{ fontSize: "0.85rem", color: "#cbd5e1", marginTop: 12 }}>
            Watch the duelists answer first. Your team will earn a bonus if your duelist wins.
          </div>
        </div>
      )}

      {phase === PHASE.ACTIVE && dispatched && (
        <div style={modalActive}>
          <div style={duelLabel}>⚔️ YOU'RE UP — {dispatched.opponentTeam ? `vs ${dispatched.opponentTeam}` : "duel"}</div>
          <div style={{ fontSize: "1.05rem", color: "#f1f5f9", margin: "10px 0", lineHeight: 1.4 }}>
            {dispatched.question?.prompt}
          </div>
          {deadlineSec !== null && (
            <div style={{ fontSize: "0.78rem", color: deadlineSec < 6 ? "#fca5a5" : "#94a3b8", marginBottom: 8 }}>
              ⏱ {deadlineSec}s left
            </div>
          )}
          {dispatched.question?.type === "true-false" ? (
            <div style={{ display: "flex", gap: 8 }}>
              {["true", "false"].map((val) => (
                <button
                  key={val}
                  type="button"
                  disabled={busy}
                  onClick={() => { setSubmission(val); setTimeout(() => { handleSubmit(); }, 0); }}
                  style={{
                    ...primaryBtn,
                    background: val === "true" ? "#22c55e" : "#ef4444",
                    flex: 1,
                    fontSize: "1.1rem",
                  }}
                >
                  {val === "true" ? "TRUE" : "FALSE"}
                </button>
              ))}
            </div>
          ) : (
            <>
              <input
                type="text"
                value={submission}
                onChange={(e) => setSubmission(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                disabled={busy}
                placeholder="Your answer…"
                autoFocus
                style={textInput}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy || !submission.trim()}
                style={{ ...primaryBtn, opacity: !submission.trim() ? 0.5 : 1 }}
              >
                {busy ? "…" : "Submit"}
              </button>
            </>
          )}
          {wrong && (
            <div style={{ fontSize: "0.82rem", color: "#fca5a5", marginTop: 8 }}>
              Not quite — try again!
            </div>
          )}
        </div>
      )}

      {phase === PHASE.RESULT && result && (
        <div style={modalCenter}>
          {result.outcome === "timeout" ? (
            <>
              <div style={{ fontSize: "3rem" }}>⌛</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#fde68a" }}>Time's up</div>
              <div style={{ fontSize: "0.9rem", color: "#cbd5e1", marginTop: 4 }}>{result.message}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: "3rem" }}>{result.winningTeamId === teamId ? "🏆" : "🥈"}</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: result.winningTeamId === teamId ? "#22c55e" : "#cbd5e1" }}>
                {result.winningTeamId === teamId ? "Your team won the duel!" : "Other team won this round"}
              </div>
              <div style={{ fontSize: "0.85rem", color: "#cbd5e1", marginTop: 8 }}>
                {result.winningPlayer} answered correctly
              </div>
              {result.question?.correctAnswer ? (
                <div style={{ fontSize: "0.82rem", color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
                  Answer: {result.question.correctAnswer}
                </div>
              ) : null}
              <div style={{ fontSize: "0.85rem", color: "#fde68a", marginTop: 10 }}>
                {result.winningTeamId === teamId ? `+${result.winBonus} pts` : `+${result.consolation} consolation`}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.92)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
const modalCenter = {
  background: "linear-gradient(135deg, #1f2937, #312e81)",
  border: "1px solid #7c3aed",
  borderRadius: 16,
  padding: "24px 28px",
  textAlign: "center",
  maxWidth: 420,
  width: "100%",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const modalActive = {
  ...modalCenter,
  textAlign: "left",
};
const duelLabel = {
  fontSize: "0.72rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 3,
  color: "#c4b5fd",
};
const vsLine = {
  fontSize: "1.15rem",
  color: "#f1f5f9",
  marginTop: 12,
};
const countdownNumber = {
  fontSize: "5rem",
  fontWeight: 900,
  color: "#fde68a",
  textShadow: "0 4px 24px rgba(251,191,36,0.6)",
  margin: "16px 0 6px",
  fontVariantNumeric: "tabular-nums",
};
const textInput = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "1.05rem",
  borderRadius: 10,
  border: "1px solid #475569",
  background: "rgba(15,23,42,0.7)",
  color: "#f1f5f9",
  outline: "none",
  marginBottom: 10,
};
const primaryBtn = {
  padding: "12px 24px",
  fontSize: "1rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 12,
  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
  color: "#fff",
  cursor: "pointer",
  width: "100%",
};
