// student-app/src/components/tasks/types/RolePlayDeckTask.jsx
import React, { useState, useEffect, useRef } from "react";

const RolePlayDeckTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const playerNames = task.config.playerNames || Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  const roles = task.config.roles || []; // AI-generated: [{ name, role, characteristics: [] }, ...]
  const scenario = task.config.scenario || "Role-play the scenario using your characters.";

  const myPlayerNumber = task.myPlayerNumber || 1; // 1-based
  const [currentTurn, setCurrentTurn] = useState(1); // 1-based turn
  const [mode, setMode] = useState(null); // "mystery" or "classic"
  const [assignedRoles, setAssignedRoles] = useState(Array(playerCount).fill(null)); // Index = player-1
  const [deckSpinning, setDeckSpinning] = useState(false);
  const [allRolesAssigned, setAllRolesAssigned] = useState(false);
  const [rolePlayStarted, setRolePlayStarted] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
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
          onSubmit({ rolePlayComplete: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleModeChoice = (chosenMode) => {
    socket.current.emit("role-play-mode", { roomCode, teamId, mode: chosenMode });
    setMode(chosenMode);
  };

  const drawRole = () => {
    if (deckSpinning || !isMyTurn) return;
    setDeckSpinning(true);

    // Simulate card draw animation
    setTimeout(() => {
      const newRoles = [...assignedRoles];
      newRoles[currentTurn - 1] = roles[currentTurn - 1];
      setAssignedRoles(newRoles);

      const allAssigned = newRoles.every(r => r !== null);
      setAllRolesAssigned(allAssigned);

      setDeckSpinning(false);

      if (allAssigned) {
        setRolePlayStarted(true);
      } else {
        setCurrentTurn((currentTurn % playerCount) + 1);
      }
    }, 2000); // 2s animation
  };

  const handleEndRolePlay = () => {
    setSubmissionFeedback({ message: "Role-Play Complete!", positive: true });
    startOverlayTimer();
  };

  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <h2>Role Play Deck</h2>

      {/* Mode Choice */}
      {!mode && (
        <div style={{ margin: "40px 0" }}>
          <h3>Choose Role-Play Mode</h3>
          <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
            <button
              onClick={() => handleModeChoice("mystery")}
              style={{
                padding: "16px 40px",
                fontSize: "1.3rem",
                background: "#6366f1",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              Mystery Mode (Roles Hidden)
            </button>
            <button
              onClick={() => handleModeChoice("classic")}
              style={{
                padding: "16px 40px",
                fontSize: "1.3rem",
                background: "#22c55e",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              Classic Mode (Roles Visible)
            </button>
          </div>
        </div>
      )}

      {/* Role Draw */}
      {mode && !allRolesAssigned && (
        <div style={{ margin: "40px 0" }}>
          <h3>Player {currentTurn}'s Turn</h3>
          <p>{isMyTurn ? "Hold the device and tap to draw your role!" : "Waiting for Player " + currentTurn}</p>

          {isMyTurn && (
            <button
              onClick={drawRole}
              disabled={deckSpinning}
              style={{
                padding: "20px 48px",
                fontSize: "1.5rem",
                background: "#22c55e",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {deckSpinning ? "Drawing..." : "Draw Role Card"}
            </button>
          )}
        </div>
      )}

      {/* Assigned Roles */}
      {mode && assignedRoles.some(r => r !== null) && (
        <div style={{ margin: "32px 0" }}>
          <h3>Your Roles</h3>
          {playerNames.map((name, i) => {
            const role = assignedRoles[i];
            const visible = mode === "classic" || (mode === "mystery" && i + 1 === myPlayerNumber);
            return (
              <div
                key={i}
                style={{
                  margin: "16px 0",
                  padding: 20,
                  background: "#f9fafb",
                  borderRadius: 16,
                  border: "1px solid #e2e8f0",
                }}
              >
                <strong>{name}</strong>
                {role && visible && (
                  <div style={{ marginTop: 12 }}>
                    <div><strong>Name:</strong> {role.name}</div>
                    <div><strong>Role:</strong> {role.role}</div>
                    <div><strong>Characteristics:</strong> {role.characteristics.join(", ")}</div>
                  </div>
                )}
                {role && !visible && (
                  <div style={{ marginTop: 12, fontStyle: "italic", color: "#64748b" }}>
                    Role Hidden (Mystery Mode)
                  </div>
                )}
                {!role && <div style={{ marginTop: 12, color: "#94a3b8" }}>Waiting to draw...</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Scenario & Role-Play */}
      {allRolesAssigned && (
        <div style={{ margin: "40px 0" }}>
          <h3>Scenario</h3>
          <div style={{ fontSize: "1.3rem", lineHeight: 1.6, marginBottom: 32 }}>
            {scenario}
          </div>
          <p>Role-play the scenario using your characters!</p>
          <button
            onClick={handleEndRolePlay}
            style={{
              marginTop: 20,
              padding: "16px 40px",
              fontSize: "1.4rem",
              background: "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            End Role-Play
          </button>
        </div>
      )}

      {/* 15s Post-Submission Overlay */}
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
          <div style={{ fontSize: "3rem", marginBottom: 24 }}>
            {submissionFeedback.message}
          </div>
          <div style={{ marginTop: 40, fontSize: "1.6rem" }}>
            Next in {overlayTimer}s...
          </div>
        </div>
      )}

      {/* Waiting Message */}
      {!currentTask && !submissionFeedback && !showQrScanner && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <h2 style={{ fontSize: "2.2rem" }}>Waiting for your next task…</h2>
          <p style={{ fontSize: "1.5rem", color: "#64748b" }}>Get ready to Curriculate!</p>
        </div>
      )}
    </div>
  );
};

export default RolePlayDeckTask;