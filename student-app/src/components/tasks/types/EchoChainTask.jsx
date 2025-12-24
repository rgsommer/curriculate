// student-app/src/components/tasks/types/EchoChainTask.jsx
import React, { useState, useEffect, useRef } from "react";

const EchoChainTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const startWord = task.config.startWord || "Concept";
  const hasTimer = task.config.hasTimer || false;

  const myPlayerNumber = task.myPlayerNumber || 1;
  const [currentTurn, setCurrentTurn] = useState(1);
  const [chain, setChain] = useState([startWord]);
  const [input, setInput] = useState("");
  const [timer, setTimer] = useState(hasTimer ? 10 : 0);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const timerRef = useRef(null);
  const overlayTimerRef = useRef(null);

  const isMyTurn = currentTurn === myPlayerNumber;

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          onSubmit({ chainComplete: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    if (hasTimer && isMyTurn) {
      setTimer(10);
      timerRef.current = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            nextTurn(); // Auto next on time out
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  }, [isMyTurn, hasTimer]);

  const handleAdd = () => {
    if (!isMyTurn || !input.trim()) return;
    setChain([...chain, input.trim()]);
    setInput("");
    nextTurn();
  };

  const nextTurn = () => {
    if (currentTurn === playerCount) {
      setSubmissionFeedback({ message: "Chain Complete!", positive: true });
      startOverlayTimer();
    } else {
      setCurrentTurn(currentTurn + 1);
    }
  };

  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <h2>Echo Chain</h2>

      <div style={{ fontSize: "1.4rem", margin: "16px 0" }}>
        Turn: Player {currentTurn} {isMyTurn && "(You!)"}
      </div>

      {hasTimer && (
        <div style={{ fontSize: "2.5rem", color: timer <= 3 ? "#ef4444" : "#000" }}>
          {timer}s
        </div>
      )}

      <div style={{ margin: "32px 0", fontSize: "1.4rem" }}>
        Current Chain:
        <div style={{ marginTop: 16, fontWeight: 700 }}>
          {chain.join(" → ")}
        </div>
      </div>

      {isMyTurn && (
        <div>
          <input
            placeholder="Add your word/phrase..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            style={{ width: "80%", padding: 12 }}
          />
          <button onClick={handleAdd} style={{ marginLeft: 12 }}>
            Add
          </button>
        </div>
      )}

      {!isMyTurn && (
        <p>Waiting for Player {currentTurn}...</p>
      )}

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

export default EchoChainTask;