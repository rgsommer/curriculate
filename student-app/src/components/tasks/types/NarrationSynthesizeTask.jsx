// student-app/src/components/tasks/types/NarrationSynthesizeTask.jsx
import React, { useState, useEffect, useRef } from "react";
import useSound from "use-sound";

const NarrationSynthesizeTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const playerNames = task.config.playerNames || Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  const allConcepts = task.config.concepts || ["Photosynthesis", "Gravity", "Democracy", "Water Cycle"]; // AI-generated

  const myPlayerNumber = task.myPlayerNumber || 1; // 1-based
  const [currentTurn, setCurrentTurn] = useState(1); // 1-based player turn
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelAngle, setWheelAngle] = useState(0);
  const [currentConcept, setCurrentConcept] = useState(null);
  const [narrationsComplete, setNarrationsComplete] = useState(Array(playerCount).fill(false));
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  // Sounds
  const [playSpin] = useSound("/sounds/wheel-spin.mp3");
  const [playTick] = useSound("/sounds/wheel-tick.mp3");
  const [playLand] = useSound("/sounds/wheel-land.mp3");

  const colors = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ec4899", "#14b8a6", "#ec4899"];

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          onSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const spinWheel = () => {
    if (wheelSpinning || !isMyTurn) return;
    setWheelSpinning(true);
    playSpin();

    const spins = 5 + Math.random() * 3;
    const segmentAngle = 360 / allConcepts.length;
    const randomSegment = Math.floor(Math.random() * allConcepts.length);
    const finalAngle = wheelAngle + spins * 360 + randomSegment * segmentAngle;

    setWheelAngle(finalAngle);

    let ticks = 0;
    const tickInterval = setInterval(() => {
      playTick();
      ticks++;
      if (ticks > 40) clearInterval(tickInterval);
    }, 100);

    setTimeout(() => {
      setWheelSpinning(false);
      playLand();
      setCurrentConcept(allConcepts[randomSegment]);
    }, 4000);
  };

  const handleNarrationComplete = () => {
    const newComplete = [...narrationsComplete];
    newComplete[currentTurn - 1] = true;
    setNarrationsComplete(newComplete);

    if (newComplete.every(c => c)) {
      setSubmissionFeedback({ message: "All narrations complete!", positive: true });
      startOverlayTimer();
    } else {
      setCurrentTurn((currentTurn % playerCount) + 1);
      setCurrentConcept(null);
    }
  };

  const isMyTurn = currentTurn === myPlayerNumber;

  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <h2>Narration Synthesize</h2>

      <div style={{ fontSize: "1.6rem", marginBottom: 20 }}>
        Turn: Player {currentTurn} {isMyTurn && "(You!)"}
      </div>

      {/* Wheel with Concepts */}
      <div style={{ position: "relative", width: 320, height: 320, margin: "40px auto" }}>
        <svg
          width="320"
          height="320"
          viewBox="0 0 320 320"
          style={{
            transform: `rotate(${wheelAngle}deg)`,
            transition: wheelSpinning ? "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
          }}
        >
          {allConcepts.map((concept, i) => {
            const angle = (i * 360) / allConcepts.length;
            const color = colors[i % colors.length];
            return (
              <g key={i}>
                <path
                  d={`M160,160 L${160 + 150 * Math.cos((angle * Math.PI) / 180)},${160 + 150 * Math.sin((angle * Math.PI) / 180)} A150,150 0 0,1 ${160 + 150 * Math.cos(((angle + 360 / allConcepts.length) * Math.PI) / 180)},${160 + 150 * Math.sin(((angle + 360 / allConcepts.length) * Math.PI) / 180)} Z`}
                  fill={color}
                  stroke="#fff"
                  strokeWidth="4"
                />
                <text
                  x="160"
                  y="160"
                  fill="#fff"
                  fontSize="16"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${angle + 180 / allConcepts.length} 160 160)`}
                >
                  {concept}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", fontSize: "50px" }}>
          ▼
        </div>
      </div>

      {/* Spin Button */}
      {isMyTurn && !currentConcept && (
        <button
          onClick={spinWheel}
          disabled={wheelSpinning}
          style={{
            padding: "16px 40px",
            fontSize: "1.4rem",
            background: "#22c55e",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          {wheelSpinning ? "Spinning..." : "Spin for Your Concept!"}
        </button>
      )}

      {/* Current Concept */}
      {currentConcept && isMyTurn && (
        <div style={{ margin: "40px 0" }}>
          <h3>Your Concept:</h3>
          <div style={{ fontSize: "2rem", fontWeight: 900, padding: 20, background: "#1e293b", color: "#22c55e", borderRadius: 16 }}>
            {currentConcept}
          </div>
          <p style={{ marginTop: 20 }}>Narrate this concept to your team!</p>
          <button onClick={handleNarrationComplete} style={{ marginTop: 20, padding: "16px 32px", background: "#3b82f6", color: "#fff", borderRadius: 999 }}>
            I've Narrated
          </button>
        </div>
      )}

      {/* Waiting for Other Player */}
      {!isMyTurn && currentConcept && (
        <div style={{ margin: "40px 0" }}>
          <p>Player {currentTurn} is narrating...</p>
        </div>
      )}

      {/* Post-Submission Overlay */}
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

export default NarrationSynthesizeTask;