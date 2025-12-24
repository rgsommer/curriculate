// student-app/src/components/tasks/types/FakeOutTask.jsx
import React, { useState } from "react";

const FakeOutTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const playerNames = task.config.playerNames || Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  const rounds = task.config.rounds || [];
  const [currentRound, setCurrentRound] = useState(0);
  const [currentTurn, setCurrentTurn] = useState(1); // Reader turn
  const [votes, setVotes] = useState(Array(playerCount).fill(null)); // null or 0-2
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  const myPlayerNumber = task.myPlayerNumber || 1;
  const isReader = currentTurn === myPlayerNumber;
  const canVote = !isReader;

  const round = rounds[currentRound] || { statement: "", options: [], correctIndex: 0 };

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          nextRound();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleVote = (choiceIndex) => {
    if (!canVote) return;
    const newVotes = [...votes];
    newVotes[myPlayerNumber - 1] = choiceIndex;
    setVotes(newVotes);
  };

  const handleSubmit = () => {
    let points = 0;
    votes.forEach((v) => {
      if (v === round.correctIndex) points += 10;
    });
    setSubmissionFeedback({ message: `Correct was Option ${round.correctIndex + 1}! Team +${points} pts`, positive: true });
    startOverlayTimer();
  };

  const allVoted = votes.every(v => v !== null);

  const nextRound = () => {
    if (currentRound < rounds.length - 1) {
      setCurrentRound(currentRound + 1);
      setCurrentTurn((currentTurn % playerCount) + 1);
      setVotes(Array(playerCount).fill(null));
    } else {
      onSubmit({ gameComplete: true });
    }
  };

  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <h2>Fake Out</h2>

      <div style={{ fontSize: "1.4rem", margin: "16px 0" }}>
        Round {currentRound + 1} of {rounds.length} • Reader: Player {currentTurn}
      </div>

      <div style={{ margin: "24px 0", padding: 20, background: "#f3f4f6", borderRadius: 16 }}>
        <strong style={{ fontSize: "1.3rem" }}>{round.statement}</strong>
      </div>

      {/* Options as Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, margin: "32px 0" }}>
        {round.options.map((opt, i) => (
          <div
            key={i}
            style={{
              padding: 20,
              background: "#fff",
              borderRadius: 16,
              border: "3px solid #e2e8f0",
              boxShadow: "0 8px 20px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Option {i + 1}</div>
            <div style={{ fontSize: "1.1rem" }}>{opt}</div>

            {/* Vote Indicators */}
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
              {playerNames.map((_, pIdx) => {
                const voted = votes[pIdx] === i;
                return (
                  <div
                    key={pIdx}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: voted ? "#22c55e" : "#e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: voted ? "#fff" : "#64748b",
                      fontWeight: 700,
                    }}
                  >
                    {pIdx + 1}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Voting Buttons */}
      {canVote && (
        <div style={{ margin: "32px 0" }}>
          <h3>Your Vote</h3>
          <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                onClick={() => handleVote(i)}
                style={{
                  padding: "16px 32px",
                  fontSize: "1.3rem",
                  background: votes[myPlayerNumber - 1] === i ? "#22c55e" : "#e2e8f0",
                  color: votes[myPlayerNumber - 1] === i ? "#fff" : "#000",
                  borderRadius: 999,
                }}
              >
                Option {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!allVoted}
        style={{
          padding: "18px 48px",
          fontSize: "1.4rem",
          background: allVoted ? "#22c55e" : "#94a3b8",
          color: "#fff",
          borderRadius: 999,
        }}
      >
        Submit Votes
      </button>

      {/* Overlay */}
      {submissionFeedback && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: "3rem", marginBottom: 24 }}>
            {submissionFeedback.message}
          </div>
          <div style={{ marginTop: 40, fontSize: "1.6rem" }}>
            Next in {overlayTimer}s...
          </div>
        </div>
      )}
    </div>
  );
};

export default FakeOutTask;