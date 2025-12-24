// student-app/src/components/tasks/types/ScriptPlayTask.jsx
import React, { useState, useEffect, useRef } from "react";

const ScriptPlayTask = ({ task, onSubmit, socket, roomCode, teamId }) => {
  const playerCount = task.config.playerCount || 1;
  const playerNames = task.config.playerNames || Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  const settings = task.config.settings || ["Victorian London", "Futuristic Space Station", "Ancient Rome"];
  const periods = task.config.periods || ["Present Day", "100 Years Ago", "200 Years in the Future"];
  const traits = task.config.traits || ["Brave", "Wise", "Humorous", "Cautious", "Creative"];

  const myPlayerNumber = task.myPlayerNumber || 1;
  const [currentTurn, setCurrentTurn] = useState(1);
  const [setting, setSetting] = useState(null);
  const [period, setPeriod] = useState(null);
  const [playerTraits, setPlayerTraits] = useState(Array(playerCount).fill([]));
  const [script, setScript] = useState(null);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [overlayTimer, setOverlayTimer] = useState(0);
  const overlayTimerRef = useRef(null);

  const startOverlayTimer = () => {
    setOverlayTimer(15);
    if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
    overlayTimerRef.current = setInterval(() => {
      setOverlayTimer((prev) => {
        if (prev <= 1) {
          clearInterval(overlayTimerRef.current);
          setSubmissionFeedback(null);
          setOverlayTimer(0);
          onSubmit({ scriptPlayComplete: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const generateScript = () => {
    // Mock script — in real app, emit to backend for AI generation
    const mockScript = {
      scenes: [
        { speaker: 0, lines: "We must find the lost artifact before it's too late!", directions: "(urgent tone)" },
        { speaker: 1, lines: "But the path is dangerous. Are you sure?", directions: "(worried)" },
        { speaker: 0, lines: "We have no choice. The future depends on it.", directions: "(determined)" },
        { speaker: 2, lines: "I'll scout ahead. Follow my lead.", directions: "(confident)" },
      ],
    };
    setScript(mockScript);
  };

  const handleNextLine = () => {
    if (currentSceneIndex < script.scenes.length - 1) {
      const nextScene = script.scenes[currentSceneIndex + 1];
      setCurrentSceneIndex(currentSceneIndex + 1);
      setCurrentTurn(nextScene.speaker + 1);
    } else {
      setSubmissionFeedback({ message: "Script Complete!", positive: true });
      startOverlayTimer();
    }
  };

  const currentScene = script?.scenes[currentSceneIndex];
  const prevScene = currentSceneIndex > 0 ? script?.scenes[currentSceneIndex - 1] : null;
  const nextScene = currentSceneIndex < script?.scenes.length - 1 ? script?.scenes[currentSceneIndex + 1] : null;

  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <h2>Script Play</h2>

      {/* Choices */}
      {!setting && (
        <div style={{ margin: "40px 0" }}>
          <h3>Choose Setting</h3>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            {settings.map(s => (
              <button key={s} onClick={() => setSetting(s)} style={{ padding: "12px 24px", background: "#6366f1", color: "#fff", borderRadius: 999 }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {setting && !period && (
        <div style={{ margin: "40px 0" }}>
          <h3>Choose Time Period</h3>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            {periods.map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: "12px 24px", background: "#6366f1", color: "#fff", borderRadius: 999 }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trait Choice */}
      {period && playerTraits.flat().length < playerCount * 1 && ( // At least 1 per player
        <div style={{ margin: "40px 0" }}>
          <h3>Choose Traits (1-2 per player)</h3>
          {playerNames.map((name, i) => (
            <div key={i} style={{ margin: "20px 0" }}>
              <strong>{name}</strong>
              <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
                {traits.map(t => (
                  <button
                    key={t}
                    onClick={() => {
                      const newTraits = [...playerTraits];
                      if (newTraits[i].includes(t)) {
                        newTraits[i] = newTraits[i].filter(tr => tr !== t);
                      } else if (newTraits[i].length < 2) {
                        newTraits[i].push(t);
                      }
                      setPlayerTraits(newTraits);
                    }}
                    style={{
                      padding: "8px 16px",
                      background: playerTraits[i].includes(t) ? "#22c55e" : "#e2e8f0",
                      color: playerTraits[i].includes(t) ? "#fff" : "#000",
                      borderRadius: 999,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button onClick={generateScript} style={{ marginTop: 32, padding: "16px 40px", background: "#22c55e", color: "#fff", borderRadius: 999 }}>
            Generate Script
          </button>
        </div>
      )}

      {/* Script with Context Lines */}
      {script && (
        <div style={{ margin: "40px 0" }}>
          <h3>Current Speaker: Player {currentTurn}</h3>

          {/* Previous Line (Context) */}
          {prevScene && (
            <div style={{ padding: 16, background: "#f3f4f6", borderRadius: 12, opacity: 0.7, marginBottom: 16 }}>
              <div style={{ fontStyle: "italic" }}>
                Previous: {playerNames[prevScene.speaker]}: "{prevScene.lines}"
              </div>
            </div>
          )}

          {/* Current Line */}
          {currentScene && (
            <div style={{ padding: 32, background: "#1e293b", color: "#22c55e", borderRadius: 16, marginBottom: 32 }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>
                {playerNames[currentScene.speaker]} ({currentScene.speaker + 1 === myPlayerNumber ? "You" : "Other"})
              </div>
              <div style={{ fontSize: "1.6rem", marginTop: 16 }}>
                "{currentScene.lines}"
              </div>
              <div style={{ fontStyle: "italic", marginTop: 16, opacity: 0.9 }}>
                ({currentScene.directions})
              </div>
            </div>
          )}

          {/* Next Line (Context) */}
          {nextScene && (
            <div style={{ padding: 16, background: "#f3f4f6", borderRadius: 12, opacity: 0.7 }}>
              <div style={{ fontStyle: "italic" }}>
                Next: {playerNames[nextScene.speaker]}: "{nextScene.lines}"
              </div>
            </div>
          )}

          <button
            onClick={handleNextLine}
            style={{
              marginTop: 40,
              padding: "16px 40px",
              fontSize: "1.4rem",
              background: "#22c55e",
              color: "#fff",
              borderRadius: 999,
            }}
          >
            Next Line → Pass Device
          </button>
        </div>
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

      {/* Waiting */}
      {!currentTask && !submissionFeedback && !showQrScanner && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <h2 style={{ fontSize: "2.2rem" }}>Waiting for your next task…</h2>
          <p style={{ fontSize: "1.5rem", color: "#64748b" }}>Get ready to Curriculate!</p>
        </div>
      )}
    </div>
  );
};

export default ScriptPlayTask;