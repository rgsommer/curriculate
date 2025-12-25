// student-app/src/components/tasks/types/FakeOutTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * FakeOutTask (Balderdash-style, intra-team only)
 * - One "Reader" holds the device and reads the statement aloud.
 * - The team listens; Reader records each player's vote.
 * - Options 1–3 are serious/plausible (ONLY ONE correct).
 * - Option 4 is a hilarious, obviously false "joke" option (never correct).
 *
 * Reporting payload: onSubmit({ type:"fake-out", roundIndex, statement, options, correctIndex, votes, playerNames, readerIndex, correctPlayers, fooledPlayers, points, ... })
 */
const FakeOutTask = ({ task, onSubmit }) => {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const playerCount = Math.max(2, Math.min(8, Number(cfg.playerCount) || 4));
  const playerNames = useMemo(() => {
    const names = Array.isArray(cfg.playerNames) ? cfg.playerNames : [];
    const cleaned = [];
    for (let i = 0; i < playerCount; i++) {
      const n = String(names[i] ?? "").trim();
      cleaned.push(n || `Player ${i + 1}`);
    }
    return cleaned;
  }, [cfg.playerNames, playerCount]);

  const rounds = useMemo(() => {
    const r = Array.isArray(cfg.rounds) ? cfg.rounds : [];
    return r
      .map((x) => {
        const statement = String(x?.statement ?? "").trim();
        const optionsRaw = Array.isArray(x?.options) ? x.options : [];
        const options = optionsRaw.map((o) => String(o ?? "").trim()).filter(Boolean);

        // Ensure exactly 4 options for UI consistency
        while (options.length < 4) options.push("");
        const fixedOptions = options.slice(0, 4);

        // correctIndex must be 0..2 (option 4 is a joke)
        let correctIndex = Number(x?.correctIndex);
        if (!Number.isFinite(correctIndex) || correctIndex < 0 || correctIndex > 2) correctIndex = 0;

        return { statement, options: fixedOptions, correctIndex };
      })
      .filter((x) => x.statement);
  }, [cfg.rounds]);

  const pointsPerCorrect = Math.max(1, Math.min(50, Number(cfg.pointsPerCorrect) || 10));
  const readerBonusPoints = Math.max(0, Math.min(50, Number(cfg.readerBonusPoints) || 5));

  const [roundIndex, setRoundIndex] = useState(0);
  const [readerIndex, setReaderIndex] = useState(0); // 0-based
  const [votes, setVotes] = useState(Array(playerCount).fill(null)); // null or 0..3
  const [revealed, setRevealed] = useState(false);

  // overlay countdown between rounds (keeps the “big reveal” moment consistent with Curriculate style)
  const [overlaySeconds, setOverlaySeconds] = useState(0);
  const overlayRef = useRef(null);

  const round = rounds[roundIndex];

  useEffect(() => {
    // reset state on round change
    setVotes(Array(playerCount).fill(null));
    setRevealed(false);
    setOverlaySeconds(0);
    if (overlayRef.current) {
      clearInterval(overlayRef.current);
      overlayRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex, readerIndex, playerCount]);

  const setPlayerVote = (playerIdx, optionIdx) => {
    if (revealed) return;
    if (playerIdx === readerIndex) return; // Reader doesn't vote
    setVotes((prev) => {
      const next = [...prev];
      next[playerIdx] = optionIdx;
      return next;
    });
  };

  const allNonReaderVoted = useMemo(() => {
    return votes.every((v, idx) => idx === readerIndex || v !== null);
  }, [votes, readerIndex]);

  const computeOutcome = () => {
    const correctIndex = round?.correctIndex ?? 0;

    const correctPlayers = [];
    const fooledPlayers = [];
    for (let i = 0; i < playerCount; i++) {
      if (i === readerIndex) continue;
      const v = votes[i];
      if (v === null || v === undefined) continue;
      if (v === correctIndex) correctPlayers.push(i);
      else fooledPlayers.push(i);
    }

    const teamPoints = correctPlayers.length * pointsPerCorrect;
    const readerBonus = fooledPlayers.length > 0 ? readerBonusPoints : 0;

    return { correctIndex, correctPlayers, fooledPlayers, teamPoints, readerBonus };
  };

  const submitAndReveal = () => {
    if (!round) return;
    if (!allNonReaderVoted) return;

    const { correctIndex, correctPlayers, fooledPlayers, teamPoints, readerBonus } = computeOutcome();
    setRevealed(true);

    // ---- REPORTING PAYLOAD (rich) ----
    const payload = {
      type: "fake-out",
      taskType: "fake-out",
      taskId: task?._id || task?.id || undefined,
      title: task?.title || "Fake Out",
      roundIndex,
      totalRounds: rounds.length,
      readerIndex,
      readerName: playerNames[readerIndex],
      playerNames,
      statement: round.statement,
      options: round.options,
      correctIndex, // 0..2 only
      votes, // per player index -> option index
      correctPlayers,
      fooledPlayers,
      pointsPerCorrect,
      readerBonusPoints,
      teamPoints,
      readerBonus,
      interTeamEnabled: false,
      intraTeamEnabled: true,
      submittedAt: new Date().toISOString(),
      completed: roundIndex >= rounds.length - 1,
    };

    onSubmit?.(payload);

    // Big reveal overlay timer
    startOverlayTimer();
  };

  const startOverlayTimer = () => {
    const seconds = 4;
    setOverlaySeconds(seconds);
    if (overlayRef.current) clearInterval(overlayRef.current);
    overlayRef.current = setInterval(() => {
      setOverlaySeconds((s) => {
        const next = s - 1;
        if (next <= 0) {
          if (overlayRef.current) clearInterval(overlayRef.current);
          overlayRef.current = null;
          // advance automatically when the overlay ends
          goNext();
          return 0;
        }
        return next;
      });
    }, 1000);
  };

  const goNext = () => {
    if (!rounds.length) return;

    // last round -> mark complete
    if (roundIndex >= rounds.length - 1) {
      onSubmit?.({
        type: "fake-out",
        taskType: "fake-out",
        taskId: task?._id || task?.id || undefined,
        title: task?.title || "Fake Out",
        gameComplete: true,
        completed: true,
        interTeamEnabled: false,
        intraTeamEnabled: true,
        submittedAt: new Date().toISOString(),
      });
      return;
    }

    setRoundIndex((r) => r + 1);
    setReaderIndex((ri) => (ri + 1) % playerCount);
  };

  if (!rounds.length || !round) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>Fake Out</div>
        <div style={{ marginTop: 8, color: "#64748b" }}>
          No rounds were provided for this task. Regenerate to try again.
        </div>
      </div>
    );
  }

  const { correctIndex, correctPlayers, fooledPlayers, teamPoints, readerBonus } = revealed ? computeOutcome() : {
    correctIndex: round.correctIndex,
    correctPlayers: [],
    fooledPlayers: [],
    teamPoints: 0,
    readerBonus: 0,
  };

  return (
    <div style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header chips */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            🤥 Fake Out
          </div>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            Round {roundIndex + 1} / {rounds.length}
          </div>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            Reader: {playerNames[readerIndex]}
          </div>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            Options 1–3 serious • Option 4 🤪 joke
          </div>
        </div>

        <button
          onClick={submitAndReveal}
          disabled={!allNonReaderVoted || revealed}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "none",
            background: revealed ? "#0f172a" : allNonReaderVoted ? "#16a34a" : "#9ca3af",
            color: "#fff",
            fontWeight: 900,
            cursor: !allNonReaderVoted || revealed ? "not-allowed" : "pointer",
          }}
          title={revealed ? "Revealed" : allNonReaderVoted ? "Reveal the correct answer" : "Record all votes first"}
        >
          {revealed ? "Revealed" : "Reveal & Score"}
        </button>
      </div>

      {/* Statement card */}
      <div
        style={{
          marginTop: 14,
          padding: 16,
          borderRadius: 16,
          border: "2px solid #e2e8f0",
          background: "linear-gradient(135deg, #ffffff, #eef2ff)",
        }}
      >
        <div style={{ fontWeight: 900, color: "#334155" }}>📣 Reader: read aloud</div>
        <div style={{ marginTop: 8, fontWeight: 900, fontSize: 18, lineHeight: 1.25 }}>
          {round.statement}
        </div>
        <div style={{ marginTop: 8, color: "#475569", fontSize: 14 }}>
          Team listens and discusses briefly. Reader taps each player’s vote under the option they chose.
        </div>
      </div>

      {/* Options list */}
      <div style={{ flex: 1, overflow: "auto", marginTop: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {round.options.map((opt, i) => {
            const isCorrect = revealed && i === correctIndex;
            return (
              <div
                key={i}
                style={{
                  padding: 18,
                  background: "#fff",
                  borderRadius: 16,
                  border: isCorrect ? "3px solid #16a34a" : "3px solid #e2e8f0",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>Option {i + 1}</div>
                  {i === 3 && (
                    <div
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "#fff7ed",
                        border: "2px solid #fdba74",
                        color: "#9a3412",
                        fontWeight: 900,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      🤪 Obviously False
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 8, fontSize: 16, lineHeight: 1.25, color: "#111827" }}>
                  {opt || <span style={{ color: "#94a3b8" }}>(missing option)</span>}
                </div>

                {/* Per-player vote chips */}
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {playerNames.map((name, pIdx) => {
                    const voted = votes[pIdx] === i;
                    const isReader = pIdx === readerIndex;

                    return (
                      <button
                        key={pIdx}
                        disabled={isReader || revealed}
                        onClick={() => setPlayerVote(pIdx, i)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 999,
                          border: voted ? "2px solid #0ea5e9" : "2px solid #cbd5e1",
                          background: voted ? "#eff6ff" : "#f8fafc",
                          color: "#0f172a",
                          fontWeight: 800,
                          cursor: isReader || revealed ? "not-allowed" : "pointer",
                          opacity: isReader ? 0.6 : 1,
                        }}
                        title={isReader ? "Reader does not vote" : "Tap to set this player's vote"}
                      >
                        {name} {isReader ? "📣" : voted ? "✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reveal footer */}
      {revealed && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 16,
            border: "2px solid #e2e8f0",
            background: "#0f172a",
            color: "#fff",
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 16 }}>
            ✅ Correct: Option {correctIndex + 1}
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
            {correctPlayers.length} correct • {fooledPlayers.length} fooled • Team +{teamPoints} pts
            {readerBonus ? ` • Reader +${readerBonus} bonus` : ""}
          </div>
        </div>
      )}

      {/* Overlay between rounds */}
      {revealed && overlaySeconds > 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            textAlign: "center",
            padding: 20,
          }}
        >
          <div>
            <div style={{ fontSize: "2.2rem", fontWeight: 1000 }}>🎉 Reveal!</div>
            <div style={{ marginTop: 14, fontSize: "1.4rem" }}>
              Next round in <span style={{ fontWeight: 1000 }}>{overlaySeconds}</span>…
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FakeOutTask;
