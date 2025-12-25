// student-app/src/components/tasks/types/FakeOutTask.jsx
import React, { useState } from "react";

const FakeOutTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const playerNames = task.config.playerNames || Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  const rounds = task.config.rounds || [];
  const [currentRound, setCurrentRound] = useState(0);
  const [readerIndex, setReaderIndex] = useState(0);
  const [votes, setVotes] = useState(Array(playerCount).fill(null));
  const [revealed, setRevealed] = useState(false);

  const round = rounds[currentRound];

  const submitVotes = () => {
    if (!round) return;

    setRevealed(true);

    const correctIndex = round.correctIndex;
    const correctPlayers = votes
      .map((v, idx) => (idx === readerIndex ? null : v === correctIndex ? idx : null))
      .filter((x) => x !== null);

    const fooledPlayers = votes
      .map((v, idx) => (idx === readerIndex ? null : v !== null && v !== correctIndex ? idx : null))
      .filter((x) => x !== null);

    const payload = {
      type: "fake-out",
      roundIndex: currentRound,
      readerIndex,
      votes,
      correctIndex,
      correctPlayers,
      fooledPlayers,
      completed: currentRound >= rounds.length - 1,
    };

    onSubmit?.(payload);
  };

  const nextRound = () => {
    const next = currentRound + 1;
    if (next >= rounds.length) return;
    setCurrentRound(next);
    setReaderIndex((readerIndex + 1) % playerCount);
    setVotes(Array(playerCount).fill(null));
    setRevealed(false);
  };

  if (!round) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>Fake Out</div>
        <div style={{ marginTop: 8, color: "#64748b" }}>
          No rounds were provided. Regenerate this task.
        </div>
      </div>
    );
  }

  const allVoted = votes.every((v, idx) => idx === readerIndex || v !== null);

  return (
    <div style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            Round {currentRound + 1} / {rounds.length}
          </div>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            Reader: {playerNames[readerIndex]}
          </div>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            Options 1–3: serious • Option 4: 🤪 joke
          </div>
        </div>

        {revealed ? (
          <button
            onClick={nextRound}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: "none",
              background: "#0ea5e9",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Next →
          </button>
        ) : (
          <button
            onClick={submitVotes}
            disabled={!allVoted}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: "none",
              background: allVoted ? "#16a34a" : "#9ca3af",
              color: "#fff",
              fontWeight: 900,
              cursor: allVoted ? "pointer" : "not-allowed",
            }}
          >
            Reveal & Score
          </button>
        )}
      </div>

      {/* Statement */}
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
        <div style={{ marginTop: 8, fontWeight: 900, fontSize: 18, lineHeight: 1.25 }}>{round.statement}</div>
        <div style={{ marginTop: 8, color: "#475569", fontSize: 14 }}>
          Team listens and discusses briefly. Reader taps each player’s vote below.
        </div>
      </div>

      {/* Options */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, margin: "24px 0" }}>
          {round.options.map((opt, i) => {
            const isCorrect = revealed && i === round.correctIndex;
            return (
              <div
                key={i}
                style={{
                  padding: 20,
                  background: "#fff",
                  borderRadius: 16,
                  border: isCorrect ? "3px solid #16a34a" : "3px solid #e2e8f0",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Option {i + 1}</div>
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

                <div style={{ fontSize: 16, lineHeight: 1.25, color: "#111827" }}>{opt}</div>

                {/* Votes for this option */}
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {playerNames.map((name, pIdx) => {
                    const voted = votes[pIdx] === i;
                    const isReader = pIdx === readerIndex;

                    return (
                      <button
                        key={pIdx}
                        disabled={isReader || revealed}
                        onClick={() => {
                          if (isReader || revealed) return;
                          setVotes((prev) => {
                            const next = [...prev];
                            next[pIdx] = i;
                            return next;
                          });
                        }}
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

      {/* Reveal summary */}
      {revealed && (
        <div
          style={{
            padding: 14,
            borderRadius: 16,
            border: "2px solid #e2e8f0",
            background: "#0f172a",
            color: "#fff",
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 16 }}>
            ✅ Correct: Option {round.correctIndex + 1}
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
            (Option 4 is the obvious joke — fun to vote, but never correct.)
          </div>
        </div>
      )}
    </div>
  );
};

export default FakeOutTask;
