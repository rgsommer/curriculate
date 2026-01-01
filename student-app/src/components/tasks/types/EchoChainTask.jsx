// student-app/src/components/tasks/types/EchoChainTask.jsx
import React, { useState, useEffect, useRef } from "react";
import { TaskCardFrame, Pill, PrimaryButton, TextInput } from "../taskStyles";

const EchoChainTask = ({ task, onSubmit, socket, roomCode, teamId, disabled }) => {
  const playerCount = task?.config?.playerCount || 1;
  const startWord = task?.config?.startWord || "Concept";
  const hasTimer = task?.config?.hasTimer || false;

  const myPlayerNumber = task?.myPlayerNumber || 1;

  const [currentTurn, setCurrentTurn] = useState(1);
  const [chain, setChain] = useState([startWord]);
  const [input, setInput] = useState("");
  const [timer, setTimer] = useState(hasTimer ? 10 : 0);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);

  const timerRef = useRef(null);
  const overlayTimerRef = useRef(null);

  const isMyTurn = currentTurn === myPlayerNumber;

  const clearTimers = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (overlayTimerRef.current) {
      clearInterval(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
  };

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          overlayTimerRef.current = null;
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          onSubmit?.({ chainComplete: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    clearTimers();
    // reset when task changes
    setCurrentTurn(1);
    setChain([startWord]);
    setInput("");
    setSubmissionFeedback(null);
    setOverlayTimer(0);
    setTimer(hasTimer ? 10 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => {
    if (!hasTimer) return;
    if (!isMyTurn) return;

    setTimer(10);

    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          nextTurn(); // Auto next on time out
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, hasTimer]);

  useEffect(() => {
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = () => {
    if (disabled) return;
    if (!isMyTurn || !input.trim()) return;
    setChain((prev) => [...prev, input.trim()]);
    setInput("");
    nextTurn();
  };

  const nextTurn = () => {
    if (currentTurn === playerCount) {
      setSubmissionFeedback({ message: "Chain Complete!", positive: true });
      startOverlayTimer();
    } else {
      setCurrentTurn((t) => t + 1);
    }
  };

  const right = (
    <>
      <Pill theme="light">👤 Player {myPlayerNumber} / {playerCount}</Pill>
      <Pill theme="light">🔁 Turn {currentTurn}</Pill>
      {hasTimer ? (
        <Pill theme="light" style={{ background: timer <= 3 ? "rgba(239,68,68,0.14)" : undefined }}>
          ⏱️ {timer}s
        </Pill>
      ) : null}
    </>
  );

  return (
    <>
      <TaskCardFrame theme="light" badge="🔁 Echo Chain" title="Build a chain of related words" subtitle={`Add one word/phrase each turn. ${isMyTurn ? "Your turn!" : "Wait for your teammate."}`} right={right}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Pill theme="light" subtle>Start word</Pill>
            <Pill theme="light">{startWord}</Pill>
          </div>

          <div
            style={{
              borderRadius: 22,
              border: "1px solid rgba(15,23,42,0.10)",
              background: "rgba(255,255,255,0.78)",
              padding: 14,
              boxShadow: "0 18px 60px rgba(15,23,42,0.10)",
            }}
          >
            <div style={{ fontWeight: 1100, marginBottom: 8, color: "rgba(15,23,42,0.82)" }}>Current Chain</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 1000, color: "rgba(15,23,42,0.92)" }}>
              {chain.join(" → ")}
            </div>
          </div>

          {isMyTurn ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 950, color: "rgba(15,23,42,0.90)" }}>Your word/phrase</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 280px" }}>
                  <TextInput
                    theme="light"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder="Add your word/phrase…"
                    disabled={disabled}
                  />
                </div>
                <PrimaryButton onClick={handleAdd} disabled={disabled || !input.trim()}>
                  Add ➕
                </PrimaryButton>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <Pill theme="light">⏳ Waiting for Player {currentTurn}…</Pill>
            </div>
          )}
        </div>
      </TaskCardFrame>

      {/* Overlay */}
      {submissionFeedback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            textAlign: "center",
            padding: 20,
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: 24, fontWeight: 1100 }}>
            {submissionFeedback.message}
          </div>
          <div style={{ marginTop: 40, fontSize: "1.6rem", fontWeight: 900 }}>
            Next in {overlayTimer}s…
          </div>
        </div>
      )}
    </>
  );
};

export default EchoChainTask;
