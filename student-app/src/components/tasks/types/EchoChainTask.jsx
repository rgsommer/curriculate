// student-app/src/components/tasks/types/EchoChainTask.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { TaskCardFrame, PrimaryButton, GhostButton, TextInput } from "../taskStyles";

// CSS Keyframes for animations
const styles = `
  @keyframes fadeInScaleUp {
    from {
      opacity: 0;
      transform: scale(0.7) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  @keyframes linkConnect {
    from {
      opacity: 0;
      width: 0;
    }
    to {
      opacity: 1;
      width: 100%;
    }
  }

  @keyframes pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
    }
    50% {
      box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
    }
  }

  @keyframes confetti {
    0% {
      transform: translateY(0) rotateZ(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(-80px) rotateZ(720deg);
      opacity: 0;
    }
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  @keyframes glow {
    0%, 100% {
      text-shadow: 0 0 5px rgba(59, 130, 246, 0.5);
    }
    50% {
      text-shadow: 0 0 20px rgba(59, 130, 246, 1);
    }
  }
`;

const styleSheet = document.createElement("style");
styleSheet.textContent = styles;
if (typeof document !== "undefined") {
  document.head.appendChild(styleSheet);
}

/**
 * Echo Chain - Showstopper Gaming Experience
 * Contract: seed term MUST be provided by the task (prefer task.config.seedTerm).
 * Preserves exact props interface and onSubmit behavior.
 */
export default function EchoChainTask({ task }) {
  const seed = useMemo(() => {
    // Canonical: config.seedTerm
    const cfgSeed = task?.config?.seedTerm;
    if (typeof cfgSeed === "string" && cfgSeed.trim()) return cfgSeed.trim();

    // Fallbacks (legacy)
    const topSeed = task?.seedTerm;
    if (typeof topSeed === "string" && topSeed.trim()) return topSeed.trim();

    if (Array.isArray(task?.ECHO_CHAIN) && task.ECHO_CHAIN.length > 0) {
      const legacy = task.ECHO_CHAIN[0];
      if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
    }

    return "";
  }, [task]);

  const [chain, setChain] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [input, setInput] = useState("");
  const [seedVisible, setSeedVisible] = useState(true);
  const [revealTemporarily, setRevealTemporarily] = useState(false);
  const [celebrationActive, setCelebrationActive] = useState(false);
  const [lastAddedIndex, setLastAddedIndex] = useState(-1);
  const audioRef = useRef(null);

  const isFirstTurn = chain.length === 0 && currentPlayer === 1;
  const playerColors = [
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
    "#14b8a6", "#f97316", "#6366f1", "#06b6d4", "#84cc16", "#d97706"
  ];
  const playerColor = playerColors[(currentPlayer - 1) % playerColors.length];

  // Emoji pool for visual personality
  const playerEmojis = ["🎤", "🎸", "🎹", "🎺", "🥁", "🎻", "🎷", "🎼", "🎧", "🎙️", "🎪", "🎭"];

  const handleSubmit = () => {
    if (!input.trim()) return;

    setLastAddedIndex(chain.length);
    setChain((prev) => [...prev, input.trim()]);
    setInput("");
    setSeedVisible(false);
    setRevealTemporarily(false);
    setCurrentPlayer((p) => p + 1);

    // Trigger celebration if chain is getting long
    if (chain.length >= 4) {
      setCelebrationActive(true);
      playSound();
      setTimeout(() => setCelebrationActive(false), 1500);
    }
  };

  const playSound = () => {
    try {
      const audio = new Audio("/sounds/yay.mp3");
      audio.play().catch(() => {
        // Silent fail if sound doesn't exist
      });
    } catch (e) {
      // Silent fail
    }
  };

  const handleReset = () => {
    setChain([]);
    setCurrentPlayer(1);
    setInput("");
    setSeedVisible(true);
    setRevealTemporarily(false);
    setLastAddedIndex(-1);
    setCelebrationActive(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && seed) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <TaskCardFrame>
      <style>{`
        .echo-chain-container {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: 20px;
          padding: 32px;
          color: white;
          position: relative;
          overflow: hidden;
        }

        .echo-chain-container::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%);
          pointer-events: none;
        }

        .echo-header {
          position: relative;
          z-index: 10;
          margin-bottom: 32px;
        }

        .echo-title {
          font-size: 2.5em;
          font-weight: 900;
          margin: 0;
          background: linear-gradient(135deg, #3b82f6 0%, #ec4899 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .echo-subtitle {
          color: #cbd5e1;
          margin-top: 8px;
          font-size: 1.1em;
          font-weight: 500;
        }

        .player-selector-container {
          position: relative;
          z-index: 10;
          margin-top: 24px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          padding: 16px;
          background: rgba(51, 65, 85, 0.5);
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          margin-bottom: 32px;
        }

        .player-label {
          font-weight: 700;
          font-size: 1.1em;
        }

        .player-select {
          padding: 10px 16px;
          border-radius: 12px;
          border: 2px solid currentColor;
          background: rgba(15, 23, 42, 0.8);
          color: inherit;
          font-weight: 700;
          font-size: 1em;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .player-select:hover {
          background: rgba(59, 130, 246, 0.3);
        }

        .chain-container {
          position: relative;
          z-index: 10;
          margin-bottom: 32px;
        }

        .chain-title {
          font-size: 1.4em;
          font-weight: 800;
          margin: 0 0 16px 0;
          color: #cbd5e1;
        }

        .chain-visual {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 20px;
        }

        .chain-link {
          animation: fadeInScaleUp 0.5s ease-out forwards;
        }

        .chain-bubble {
          flex: 1;
          min-width: 80px;
          padding: 16px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(236, 72, 153, 0.2) 100%);
          border: 2px solid;
          text-align: center;
          font-weight: 700;
          font-size: 0.95em;
          word-break: break-word;
          transition: all 0.3s ease;
          position: relative;
        }

        .chain-bubble:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3);
        }

        .seed-bubble {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          border-color: #d97706;
          color: #78350f;
          font-weight: 900;
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
        }

        .input-section {
          position: relative;
          z-index: 10;
          margin-bottom: 24px;
        }

        .input-wrapper {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: stretch;
        }

        .echo-input {
          flex: 1;
          min-width: 200px;
          padding: 14px 18px;
          border-radius: 14px;
          border: 2px solid;
          background: rgba(30, 41, 59, 0.8);
          color: white;
          font-size: 1em;
          font-weight: 600;
          transition: all 0.3s ease;
        }

        .echo-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }

        .echo-input::placeholder {
          color: #64748b;
        }

        .submit-btn {
          padding: 14px 28px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%);
          color: white;
          font-weight: 800;
          font-size: 1em;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.5);
        }

        .submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .reset-btn {
          padding: 14px 28px;
          border-radius: 14px;
          border: 2px solid #64748b;
          background: transparent;
          color: #cbd5e1;
          font-weight: 700;
          font-size: 1em;
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .reset-btn:hover {
          border-color: #cbd5e1;
          background: rgba(148, 163, 184, 0.1);
        }

        .seed-display {
          position: relative;
          z-index: 10;
          padding: 20px;
          border-radius: 16px;
          margin-bottom: 24px;
          text-align: center;
          font-weight: 700;
          font-size: 1.2em;
        }

        .seed-display.visible {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          border: 2px solid #d97706;
          color: #78350f;
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
          animation: glow 2s ease-in-out infinite;
        }

        .seed-display.hidden {
          background: rgba(51, 65, 85, 0.5);
          border: 2px dashed rgba(148, 163, 184, 0.3);
          color: #cbd5e1;
        }

        .reveal-btn {
          margin-left: 12px;
          padding: 8px 16px;
          border-radius: 12px;
          border: 2px solid #3b82f6;
          background: rgba(59, 130, 246, 0.2);
          color: #3b82f6;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: 0.9em;
        }

        .reveal-btn:hover {
          background: rgba(59, 130, 246, 0.3);
        }

        .celebration-burst {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 4em;
          animation: confetti 1.5s ease-out forwards;
          pointer-events: none;
          z-index: 1000;
        }

        .current-player-highlight {
          padding: 20px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(236, 72, 153, 0.1) 100%);
          border: 2px solid;
          text-align: center;
          margin-bottom: 24px;
          animation: pulse 2s infinite;
          position: relative;
          z-index: 10;
        }

        .current-player-text {
          font-size: 1.2em;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .error-banner {
          position: relative;
          z-index: 10;
          padding: 16px;
          border-radius: 14px;
          border: 2px solid #ef4444;
          background: rgba(239, 68, 68, 0.1);
          color: #fca5a5;
          font-weight: 700;
          margin-bottom: 24px;
        }

        @media (max-width: 768px) {
          .echo-chain-container {
            padding: 20px;
          }

          .echo-title {
            font-size: 2em;
          }

          .input-wrapper {
            flex-direction: column;
          }

          .echo-input {
            min-width: 100%;
            width: 100%;
          }

          .submit-btn, .reset-btn {
            width: 100%;
          }

          .player-selector-container {
            flex-direction: column;
            align-items: stretch;
          }

          .player-select {
            width: 100%;
          }

          .chain-visual {
            flex-direction: column;
          }

          .chain-bubble {
            min-width: 100%;
          }
        }
      `}</style>

      <div className="echo-chain-container">
        {/* Header */}
        <div className="echo-header">
          <h2 className="echo-title">
            🔗 Echo Chain
          </h2>
          <div className="echo-subtitle">
            Build a glorious chain together. No silent reading—everything is spoken.
          </div>
        </div>

        {/* Player Selector */}
        <div className="player-selector-container" style={{ borderColor: playerColor }}>
          <div className="player-label" style={{ color: playerColor }}>
            {playerEmojis[currentPlayer - 1]} Current Speaker:
          </div>
          <select
            value={currentPlayer}
            onChange={(e) => setCurrentPlayer(Number(e.target.value) || 1)}
            className="player-select"
            style={{ borderColor: playerColor, color: playerColor }}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1} style={{ background: "#0f172a", color: "white" }}>
                {playerEmojis[i]} Player {i + 1}
              </option>
            ))}
          </select>
        </div>

        {/* Current Player Highlight */}
        {seed && (
          <div className="current-player-highlight" style={{ borderColor: playerColor }}>
            <div className="current-player-text">
              <span style={{ color: playerColor, animation: "bounce 1s ease-in-out infinite" }}>
                {playerEmojis[currentPlayer - 1]}
              </span>
              <span>Player {currentPlayer}'s turn to add to the chain!</span>
            </div>
          </div>
        )}

        {/* Seed Display */}
        {seed && (
          <div
            className={`seed-display ${isFirstTurn && seedVisible ? "visible" : "hidden"}`}
          >
            {isFirstTurn && seedVisible ? (
              <>
                Seed: <strong>{seed}</strong>
              </>
            ) : (
              <>
                🤫 Chain is spoken aloud. No on-screen clues.
                {!isFirstTurn && (
                  <button
                    type="button"
                    onClick={() => {
                      setRevealTemporarily(true);
                      setTimeout(() => setRevealTemporarily(false), 1500);
                    }}
                    className="reveal-btn"
                  >
                    👁️ Reveal Seed (1.5s)
                  </button>
                )}
                {revealTemporarily && (
                  <span style={{ marginLeft: 12, fontWeight: 900, color: "#000" }}>
                    {seed}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {!seed && (
          <div className="error-banner">
            ⚠️ Missing seed term! The task generator must supply config.seedTerm for the game to start.
          </div>
        )}

        {/* Chain Display */}
        {chain.length > 0 && (
          <div className="chain-container">
            <div className="chain-title">
              ✨ Your Chain ({chain.length} link{chain.length !== 1 ? "s" : ""})
            </div>
            <div className="chain-visual">
              {/* Seed Bubble */}
              <div
                className="chain-link"
                key="seed"
                style={{ animation: "fadeInScaleUp 0.5s ease-out forwards" }}
              >
                <div className="chain-bubble seed-bubble">
                  🌱 {seed}
                </div>
              </div>

              {/* Chain Links */}
              {chain.map((link, idx) => (
                <div
                  key={idx}
                  className="chain-link"
                  style={{
                    animation: `fadeInScaleUp 0.5s ease-out forwards`,
                    animationDelay: `${(idx + 1) * 0.1}s`,
                  }}
                >
                  <div
                    className="chain-bubble"
                    style={{
                      borderColor: playerColors[idx % playerColors.length],
                      backgroundColor: `${playerColors[idx % playerColors.length]}20`,
                      color: playerColors[idx % playerColors.length],
                    }}
                  >
                    {playerEmojis[idx % playerEmojis.length]} {link}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input Section */}
        {seed && (
          <div className="input-section">
            <div className="input-wrapper">
              <input
                type="text"
                className="echo-input"
                placeholder="Type the next word your team adds…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ borderColor: playerColor }}
              />
              <button
                className="submit-btn"
                onClick={handleSubmit}
                disabled={!input.trim()}
              >
                ⚡ Add
              </button>
            </div>
          </div>
        )}

        {/* Reset Button */}
        {chain.length > 0 && (
          <div style={{ position: "relative", zIndex: 10 }}>
            <button className="reset-btn" onClick={handleReset}>
              🔄 Reset Chain
            </button>
          </div>
        )}

        {/* Celebration Confetti */}
        {celebrationActive && (
          <>
            <div className="celebration-burst">🎉</div>
            <div className="celebration-burst" style={{ animationDelay: "0.2s" }}>✨</div>
            <div className="celebration-burst" style={{ animationDelay: "0.4s" }}>🎊</div>
          </>
        )}
      </div>
    </TaskCardFrame>
  );
}
