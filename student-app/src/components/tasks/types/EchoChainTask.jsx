// student-app/src/components/tasks/types/EchoChainTask.jsx
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { TaskCardFrame } from "../taskStyles";

/**
 * Echo Chain – always-on mic after each Add.
 *
 * Flow:
 *  1. Player types a word → taps Add → word joins the chain, mic starts listening.
 *  2. Next player recites the full chain out loud.
 *  3. When the mic hears the LAST word in the chain it stops → green "heard it!" badge.
 *  4. Player taps "Player X said that ✅" to confirm.
 *  5. Add input becomes enabled for the next word.
 */

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const playerColors = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f97316", "#6366f1", "#06b6d4", "#84cc16", "#d97706",
];
const playerEmojis = ["🎤", "🎸", "🎹", "🎺", "🥁", "🎻", "🎷", "🎼", "🎧", "🎙️", "🎪", "🎭"];

export default function EchoChainTask({ task, memberNames = [], practiceMode = false }) {
  /* ── seed term ── */
  const seed = useMemo(() => {
    const cfgSeed = task?.config?.seedTerm;
    if (typeof cfgSeed === "string" && cfgSeed.trim()) return cfgSeed.trim();
    const topSeed = task?.seedTerm;
    if (typeof topSeed === "string" && topSeed.trim()) return topSeed.trim();
    if (Array.isArray(task?.ECHO_CHAIN) && task.ECHO_CHAIN.length > 0) {
      const legacy = task.ECHO_CHAIN[0];
      if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
    }
    return "";
  }, [task]);

  // Pad practice with bots so the "who said that?" attribution buttons
  // demonstrate the multi-player flow.  Tester: '(in practice mode,
  // add 2 other names)'.
  const ECHO_BOTS = ["Riley (bot)", "Quinn (bot)", "Avery (bot)"];
  const names = useMemo(
    () => {
      const real = (Array.isArray(memberNames) ? memberNames.filter(Boolean) : []);
      if (practiceMode && real.length < 3) {
        const me = real[0] || "You";
        return [me, ...ECHO_BOTS.slice(0, 2)];
      }
      return real;
    },
    [memberNames, practiceMode],
  );

  /* ── state ── */
  const [chain, setChain] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [input, setInput] = useState("");
  const [seedVisible, setSeedVisible] = useState(true);
  const [revealTemporarily, setRevealTemporarily] = useState(false);
  const [celebrationActive, setCelebrationActive] = useState(false);

  // Listening / confirmation flow
  const [listening, setListening] = useState(false);     // mic is active
  const [heardIt, setHeardIt] = useState(false);          // detected last word
  const [confirmed, setConfirmed] = useState(true);       // "Player X said that" tapped (starts true so first Add works)
  const [transcript, setTranscript] = useState("");       // running transcript
  const [micError, setMicError] = useState("");           // fallback msg

  const recognitionRef = useRef(null);
  const restartTimeoutRef = useRef(null);

  const isFirstTurn = chain.length === 0 && currentPlayer === 1;
  const playerColor = playerColors[(currentPlayer - 1) % playerColors.length];
  const playerName = (idx) => names[idx - 1] || `Player ${idx}`;

  /* ── speech recognition helpers ── */
  const stopListening = useCallback(() => {
    clearTimeout(restartTimeoutRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const startListening = useCallback(
    (targetWord) => {
      stopListening();
      setHeardIt(false);
      setTranscript("");
      setMicError("");

      if (!SpeechRecognition) {
        // Browser doesn't support speech recognition – fall back to manual confirm
        setMicError("Speech recognition not available in this browser. Confirm manually.");
        return;
      }

      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = "en-US";
      recognitionRef.current = recog;

      const target = targetWord.toLowerCase().trim();

      recog.onresult = (event) => {
        let full = "";
        for (let i = 0; i < event.results.length; i++) {
          full += event.results[i][0].transcript;
        }
        setTranscript(full);

        if (full.toLowerCase().includes(target)) {
          setHeardIt(true);
          stopListening();
          try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}
        }
      };

      recog.onerror = (e) => {
        // "no-speech" is normal – just restart. "aborted" is from our own abort().
        if (e.error === "no-speech" || e.error === "aborted") return;
        console.warn("[EchoChain] speech error:", e.error);
        setMicError(`Mic error: ${e.error}. Confirm manually.`);
        stopListening();
      };

      // Chrome stops continuous recognition after ~60 s; restart automatically.
      recog.onend = () => {
        if (recognitionRef.current === recog && !heardIt) {
          restartTimeoutRef.current = setTimeout(() => {
            try { recog.start(); } catch {}
          }, 200);
        }
      };

      try {
        recog.start();
        setListening(true);
      } catch (err) {
        setMicError("Could not start microphone. Confirm manually.");
      }
    },
    [stopListening],
  );

  // Cleanup on unmount
  useEffect(() => () => stopListening(), [stopListening]);

  /* ── handlers ── */
  const handleAdd = () => {
    if (!input.trim() || !confirmed) return;

    const newWord = input.trim();
    setChain((prev) => [...prev, newWord]);
    setInput("");
    setSeedVisible(false);
    setRevealTemporarily(false);
    setConfirmed(false);         // lock Add until next player confirms
    setCurrentPlayer((p) => p + 1);
    setHeardIt(false);
    setTranscript("");
    setMicError("");

    // Tester ask: don't auto-start the mic; the next player taps
    // "Listen & Check" themselves.  Stays manual on/off after that.
    // (startListening can still be called from the toggle button below.)
    targetWordRef.current = newWord;

    if (chain.length >= 4) {
      setCelebrationActive(true);
      try { new Audio("/sounds/yay.mp3").play().catch(() => {}); } catch {}
      setTimeout(() => setCelebrationActive(false), 1500);
    }
  };

  // Last-added word — "Listen & Check" tries to detect this on mic.
  const targetWordRef = useRef("");
  const toggleListen = () => {
    if (listening) {
      stopListening();
    } else if (targetWordRef.current) {
      startListening(targetWordRef.current);
    }
  };

  const handleConfirm = () => {
    stopListening();
    setConfirmed(true);
    setHeardIt(false);
    setTranscript("");
    setMicError("");
  };

  const handleReset = () => {
    stopListening();
    setChain([]);
    setCurrentPlayer(1);
    setInput("");
    setSeedVisible(true);
    setRevealTemporarily(false);
    setCelebrationActive(false);
    setConfirmed(true);
    setHeardIt(false);
    setTranscript("");
    setMicError("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && seed && confirmed) {
      e.preventDefault();
      handleAdd();
    }
  };

  /* ── render ── */
  return (
    <TaskCardFrame>
      <style>{`
        .ec-wrap{background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:20px;padding:28px;padding-bottom:48px;color:#fff;position:relative;overflow:hidden}
        .ec-wrap::before{content:'';position:absolute;top:-50%;right:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(59,130,246,.1) 0%,transparent 70%);pointer-events:none}
        .ec-title{font-size:2.2em;font-weight:900;margin:0;background:linear-gradient(135deg,#3b82f6,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;display:flex;align-items:center;gap:10px}
        .ec-sub{color:#cbd5e1;margin-top:8px;font-size:1.05em;font-weight:500;line-height:1.6}
        .ec-chain-bar{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
        .ec-chip{padding:10px 16px;border-radius:12px;font-weight:700;font-size:.95em;text-align:center;min-width:70px;word-break:break-word}
        .ec-seed-chip{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#78350f;border:2px solid #d97706;font-weight:900;box-shadow:0 0 16px rgba(245,158,11,.35)}
        .ec-player-box{padding:16px;border-radius:14px;border:2px solid;margin:16px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .ec-input-row{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;margin:12px 0}
        .ec-input{flex:1;min-width:180px;padding:12px 16px;border-radius:12px;border:2px solid #475569;background:rgba(30,41,59,.8);color:#fff;font-size:1em;font-weight:600;outline:none}
        .ec-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.2)}
        .ec-input::placeholder{color:#64748b}
        .ec-input:disabled{opacity:.4;cursor:not-allowed}
        .ec-btn{padding:12px 24px;border-radius:12px;border:none;font-weight:800;font-size:1em;cursor:pointer;transition:all .2s;letter-spacing:.4px}
        .ec-btn:disabled{opacity:.4;cursor:not-allowed}
        .ec-add{background:linear-gradient(135deg,#3b82f6,#06b6d4);color:#fff;box-shadow:0 4px 12px rgba(59,130,246,.3)}
        .ec-confirm{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 12px rgba(16,185,129,.3);font-size:1.05em;padding:14px 28px}
        .ec-reset{padding:10px 20px;border-radius:12px;border:2px solid #64748b;background:transparent;color:#cbd5e1;font-weight:700;cursor:pointer}
        .ec-mic-badge{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;font-weight:700;font-size:.9em}
        .ec-listening{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5}
        .ec-heard{background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#6ee7b7}
        .ec-error-banner{padding:14px;border-radius:14px;border:2px solid #ef4444;background:rgba(239,68,68,.1);color:#fca5a5;font-weight:700;margin-bottom:20px}
        .ec-reveal{margin-left:10px;padding:6px 14px;border-radius:10px;border:2px solid #3b82f6;background:rgba(59,130,246,.2);color:#3b82f6;font-weight:700;cursor:pointer;font-size:.85em}
        @keyframes ec-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}
        @keyframes ec-fadein{from{opacity:0;transform:scale(.7) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes ec-confetti{0%{transform:translateY(0) rotateZ(0deg);opacity:1}100%{transform:translateY(-80px) rotateZ(720deg);opacity:0}}
        @media(max-width:768px){.ec-wrap{padding:18px}.ec-title{font-size:1.6em}.ec-input-row{flex-direction:column}.ec-input{min-width:100%}.ec-btn{width:100%}}
      `}</style>

      <div className="ec-wrap">
        {/* Header */}
        <h2 className="ec-title">🔗 Echo Chain</h2>
        <div className="ec-sub">
          <strong>How to play:</strong> See the starting word below.
          On your turn, <strong>say the entire chain out loud from memory</strong>, then <strong>add one new related word</strong>.
          The mic is listening — when it hears the last word, your teammate confirms and adds the next!
        </div>

        {/* Solo banner — Echo Chain is fundamentally multi-player.
            In practice mode we pad the player list with two bots so
            the chain still rotates, but testers (Ranbir) thought
            they were getting a "multiplayer task" they couldn't do.
            Surfacing it explicitly: you're playing all turns; the
            bot names are placeholders for whoever's beside you. */}
        {practiceMode &&
          (Array.isArray(memberNames) ? memberNames.filter(Boolean) : []).length < 2 && (
            <div
              style={{
                margin: "14px 0",
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.4)",
                color: "#fde68a",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              👤 <b>Playing solo?</b> You'll take every turn — the bot
              names are just stand-ins for teammates so the chain still
              rotates.  Got friends nearby?  Take turns; each player
              says the chain then adds a word.
            </div>
          )}

        {!seed && (
          <div className="ec-error-banner">
            ⚠️ Missing seed term! The task generator must supply config.seedTerm for the game to start.
          </div>
        )}

        {/* Seed display */}
        {seed && (
          <div
            style={{
              margin: "16px 0",
              padding: "16px",
              borderRadius: "14px",
              textAlign: "center",
              fontWeight: 700,
              fontSize: "1.15em",
              ...(isFirstTurn && seedVisible
                ? {
                    background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                    border: "2px solid #d97706",
                    color: "#78350f",
                    boxShadow: "0 0 16px rgba(245,158,11,.35)",
                  }
                : {
                    background: "rgba(51,65,85,.5)",
                    border: "2px dashed rgba(148,163,184,.3)",
                    color: "#cbd5e1",
                  }),
            }}
          >
            {isFirstTurn && seedVisible ? (
              <>🌱 Seed: <strong>{seed}</strong></>
            ) : (
              <>
                🤫 Chain is spoken aloud — no on-screen clues.
                {!isFirstTurn && (
                  <button
                    type="button"
                    className="ec-reveal"
                    onClick={() => {
                      setRevealTemporarily(true);
                      setTimeout(() => setRevealTemporarily(false), 1500);
                    }}
                  >
                    👁️ Reveal seed (1.5 s)
                  </button>
                )}
                {revealTemporarily && (
                  <span style={{ marginLeft: 10, fontWeight: 900, color: "#fbbf24" }}>{seed}</span>
                )}
              </>
            )}
          </div>
        )}

        {/* Chain chips */}
        {chain.length > 0 && (
          <div style={{ position: "relative", zIndex: 10 }}>
            <div style={{ fontSize: "1.2em", fontWeight: 800, color: "#cbd5e1", marginBottom: 8 }}>
              Current chain ({chain.length + 1})
            </div>
            <div style={{ color: "#94a3b8", fontSize: ".85em", fontWeight: 600, marginBottom: 10 }}>
              Tip: one person says the full chain out loud. Keep it hidden to avoid silent reading.
            </div>
            <div className="ec-chain-bar">
              <div className="ec-chip ec-seed-chip" style={{ animation: "ec-fadein .4s ease-out" }}>
                1. {seed}
              </div>
              {chain.map((word, idx) => (
                <div
                  key={idx}
                  className="ec-chip"
                  style={{
                    border: `2px solid ${playerColors[idx % playerColors.length]}`,
                    background: `${playerColors[idx % playerColors.length]}18`,
                    color: playerColors[idx % playerColors.length],
                    animation: `ec-fadein .4s ease-out ${idx * .08}s both`,
                  }}
                >
                  {idx + 2}. {word}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Player box + mic status */}
        {seed && (
          <div className="ec-player-box" style={{ borderColor: playerColor, background: `${playerColor}10` }}>
            <span style={{ fontSize: "1.3em" }}>{playerEmojis[(currentPlayer - 1) % playerEmojis.length]}</span>
            <span style={{ fontWeight: 800, color: playerColor, fontSize: "1.05em" }}>
              {playerName(currentPlayer)}'s turn
            </span>

            {/* Mic status badges */}
            {listening && !heardIt && (
              <span className="ec-mic-badge ec-listening" style={{ animation: "ec-pulse 1.5s infinite" }}>
                🎙️ Listening…
              </span>
            )}
            {heardIt && (
              <span className="ec-mic-badge ec-heard">
                ✅ Heard it!
              </span>
            )}
            {micError && (
              <span className="ec-mic-badge" style={{ background: "rgba(251,191,36,.15)", border: "1px solid rgba(251,191,36,.4)", color: "#fde68a" }}>
                ⚠️ {micError}
              </span>
            )}
          </div>
        )}

        {/* Confirm flow — when waiting for the next player to recite. */}
        {seed && !confirmed && (
          <div style={{ margin: "12px 0", textAlign: "center" }}>
            {/* Big call-to-action that fires after every Add so the
                next player knows exactly what to do. */}
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(59,130,246,0.10)",
                border: "1px solid rgba(59,130,246,0.45)",
                color: "#bfdbfe",
                fontSize: ".95em",
                fontWeight: 800,
                lineHeight: 1.4,
              }}
            >
              👉 <strong style={{ color: "#dbeafe" }}>Now say the entire sequence in order</strong>, then tap your name below.
            </div>

            {/* Step 1 (OPTIONAL): tap-toggle Listen & Check.  We've
                de-emphasised this because tester feedback flagged it
                as unreliable — the primary path is now to recite the
                chain aloud and tap your name to confirm. Mic is a
                bonus / verification tool only. */}
            <button
              type="button"
              onClick={toggleListen}
              className="ec-btn"
              style={{
                background: listening
                  ? "linear-gradient(135deg, #ef4444, #b91c1c)"
                  : "rgba(59,130,246,0.18)",
                color: listening ? "#fff" : "#bfdbfe",
                fontWeight: 700,
                fontSize: ".88em",
                padding: "8px 16px",
                border: listening ? "none" : "1px solid rgba(59,130,246,0.5)",
                boxShadow: listening
                  ? "0 0 0 4px rgba(239,68,68,0.25)"
                  : "none",
                animation: listening ? "ec-pulse 1.4s ease infinite" : "none",
              }}
            >
              {listening ? "🎤 Listening — tap to stop" : "🎤 Optional: tap to verify with mic"}
            </button>

            {!heardIt && listening && (
              <div style={{ marginTop: 8, color: "#fca5a5", fontSize: ".85em", fontWeight: 700 }}>
                Recite the chain — mic is open until you tap stop.
                Listening for "<strong>{chain[chain.length - 1]}</strong>"…
              </div>
            )}
            {heardIt && (
              <div style={{ marginTop: 8, color: "#6ee7b7", fontSize: ".95em", fontWeight: 800 }}>
                ✅ Heard the last word!
              </div>
            )}
            {micError && (
              <div style={{ marginTop: 8, color: "#fca5a5", fontSize: ".85em", fontWeight: 700 }}>
                {micError}
              </div>
            )}

            {/* Step 2: tap which player just recited.  Tester:
                "the player who said it taps 'Richard said that'". */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: ".82em", color: "#cbd5e1", fontWeight: 800, marginBottom: 8, letterSpacing: 0.4, textTransform: "uppercase" }}>
                Who just recited the chain?
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {(names.length > 0 ? names : [playerName(currentPlayer)]).map((nm, i) => (
                  <button
                    key={`${nm}-${i}`}
                    type="button"
                    onClick={handleConfirm}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "none",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: ".9em",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(16,185,129,.3)",
                    }}
                  >
                    {nm} said that ✅
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Input section — only enabled after confirmation */}
        {seed && (
          <div className="ec-input-row">
            <input
              type="text"
              className="ec-input"
              placeholder={
                !confirmed
                  ? `Waiting for ${playerName(currentPlayer)} to say the chain…`
                  : isFirstTurn
                    ? `Say "${seed}" aloud, then type your new word…`
                    : "Type the next word your team adds…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!confirmed}
              style={{ borderColor: confirmed ? playerColor : "#475569" }}
            />
            <button
              className="ec-btn ec-add"
              onClick={handleAdd}
              disabled={!input.trim() || !confirmed}
            >
              Add
            </button>
          </div>
        )}

        {/* Reset */}
        {chain.length > 0 && (
          <div style={{ marginTop: 12, position: "relative", zIndex: 10 }}>
            <button className="ec-reset" onClick={handleReset}>
              🔄 Reset Chain
            </button>
          </div>
        )}

        {/* Celebration */}
        {celebrationActive && (
          <>
            <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: "4em", animation: "ec-confetti 1.5s ease-out forwards", pointerEvents: "none", zIndex: 1000 }}>🎉</div>
            <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: "4em", animation: "ec-confetti 1.5s ease-out forwards", animationDelay: ".2s", pointerEvents: "none", zIndex: 1000 }}>✨</div>
          </>
        )}
      </div>
    </TaskCardFrame>
  );
}
