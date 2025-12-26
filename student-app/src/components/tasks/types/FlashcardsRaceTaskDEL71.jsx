// student-app/src/components/tasks/types/FlashcardsRaceTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import useSound from "use-sound";
import confetti from "canvas-confetti";

/**
 * FlashcardsRaceTask
 * - Works in "local mode" (cards come from task.config.items) OR "socket mode" (server broadcasts events).
 * - Designed to feel consistent with other Curriculate modules: rounded cards, bold headings, subtle gradients.
 *
 * Props (back/forward compatible):
 * - task: { config: { items:[{question,answer}], secondsPerCard, playerCount, pointsCorrect, pointsFirstBuzzBonus } }
 * - socket, roomCode, playerTeam
 * - memberNames: string[] (optional, for naming buzzer buttons)
 * - disabled: boolean
 * - onSubmit: function (optional) – send a completion snapshot back up to TaskRunner/backend
 */
export default function FlashcardsRaceTask(props) {
  const {
    task,
    socket,
    roomCode,
    playerTeam,
    memberNames = [],
    disabled = false,
    onSubmit,
  } = props || {};

  const cfg = (task?.config && typeof task.config === "object") ? task.config : {};
  const cards = useMemo(() => {
    const raw =
      (Array.isArray(cfg.items) && cfg.items) ||
      (Array.isArray(cfg.cards) && cfg.cards) ||
      (Array.isArray(task?.items) && task.items) ||
      [];
    return raw
      .filter(Boolean)
      .map((c, i) => ({
        question: String(c?.question ?? c?.q ?? c?.front ?? c?.prompt ?? `Card ${i + 1}`).trim(),
        answer: String(c?.answer ?? c?.a ?? c?.back ?? c?.response ?? "").trim(),
      }))
      .filter((c) => c.question && c.answer)
      .slice(0, 12);
  }, [cfg.items, cfg.cards, task?.items]);

  const secondsPerCard = Number.isFinite(Number(cfg.secondsPerCard)) ? Math.max(8, Number(cfg.secondsPerCard)) : 20;
  const pointsCorrect = Number.isFinite(Number(cfg.pointsCorrect)) ? Number(cfg.pointsCorrect) : 10;
  const pointsFirstBuzzBonus = Number.isFinite(Number(cfg.pointsFirstBuzzBonus)) ? Number(cfg.pointsFirstBuzzBonus) : 5;

  // 1–4 players on device (buzzers)
  const playerCount = useMemo(() => {
    const n = Number(cfg.playerCount ?? cfg.players ?? (Array.isArray(memberNames) ? memberNames.length : 2) ?? 2);
    if (Number.isFinite(n) && n >= 1 && n <= 4) return Math.round(n);
    return Math.min(4, Math.max(1, Array.isArray(memberNames) ? memberNames.length : 2)) || 2;
  }, [cfg.playerCount, cfg.players, memberNames]);

  const playerLabels = useMemo(() => {
    const base = (Array.isArray(memberNames) ? memberNames : []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
    const labels = [];
    for (let i = 0; i < playerCount; i++) {
      labels.push(base[i] || `Player ${i + 1}`);
    }
    return labels;
  }, [memberNames, playerCount]);

  // SFX
  const [playShuffle] = useSound("/sounds/shuffle.mp3", { volume: 0.75 });
  const [playPointWin] = useSound("/sounds/point-win.mp3", { volume: 0.9 });
  const [playPointLose] = useSound("/sounds/point-lose.mp3", { volume: 0.7 });
  const [playBuzzer] = useSound("/sounds/buzzer.mp3", { volume: 0.9 });

  // Local game state
  const [cardIndex, setCardIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(secondsPerCard);
  const [showShuffle, setShowShuffle] = useState(false);

  const [buzzedBy, setBuzzedBy] = useState(null); // player index
  const [attemptedPlayers, setAttemptedPlayers] = useState([]); // indices who already tried on this card
  const [answerText, setAnswerText] = useState("");

  const [scores, setScores] = useState(() => {
    const obj = {};
    for (let i = 0; i < 4; i++) obj[i] = 0;
    return obj;
  });

  const [roundWinners, setRoundWinners] = useState([]); // {cardIndex, playerIndex, correct, answer}
  const [gameOver, setGameOver] = useState(false);

  const firstBuzzRef = useRef(null); // player index of first buzz for the card
  const answeredThisCardRef = useRef(false);

  const localMode = !socket || !roomCode || !cfg.interTeam; // practical default: local

  const currentCard = cards[cardIndex] || null;

  // Reset when task changes
  useEffect(() => {
    setCardIndex(0);
    setTimeLeft(secondsPerCard);
    setShowShuffle(false);
    setBuzzedBy(null);
    setAttemptedPlayers([]);
    setAnswerText("");
    setScores(() => {
      const obj = {};
      for (let i = 0; i < 4; i++) obj[i] = 0;
      return obj;
    });
    setRoundWinners([]);
    setGameOver(false);
    firstBuzzRef.current = null;
    answeredThisCardRef.current = false;
  }, [task?._id, task?.id, secondsPerCard]);

  // Card timer (local mode only)
  useEffect(() => {
    if (!localMode) return undefined;
    if (disabled) return undefined;
    if (gameOver) return undefined;
    if (!currentCard) return undefined;
    if (showShuffle) return undefined;
    if (buzzedBy != null) return undefined; // pause timer while someone is answering

    if (timeLeft <= 0) {
      // nobody answered in time
      setRoundWinners((prev) => [
        ...prev,
        { cardIndex, playerIndex: null, correct: false, answer: "" , timeout: true },
      ]);

      nextCard();
      return undefined;
    }

    const t = setTimeout(() => setTimeLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMode, disabled, gameOver, currentCard, showShuffle, buzzedBy, timeLeft]);

  // Optional: socket mode (keep legacy events so existing backend can drive it)
  useEffect(() => {
    if (!socket) return undefined;

    const onStart = (data) => {
      playShuffle();
      setShowShuffle(true);

      setTimeout(() => {
        setShowShuffle(false);
        setCardIndex(Number(data?.cardIndex || 0));
        setTimeLeft(Number(data?.secondsPerCard || secondsPerCard));
        setBuzzedBy(null);
        setAttemptedPlayers([]);
        setAnswerText("");
        firstBuzzRef.current = null;
        answeredThisCardRef.current = false;
      }, 900);
    };

    const onNext = (data) => {
      setCardIndex(Number(data?.cardIndex || 0));
      setTimeLeft(Number(data?.secondsPerCard || secondsPerCard));
      setBuzzedBy(null);
      setAttemptedPlayers([]);
      setAnswerText("");
      firstBuzzRef.current = null;
      answeredThisCardRef.current = false;
    };

    const onWinner = (data) => {
      // legacy: winner payload uses team letters A/B, we just show confetti + basic score bump
      const team = data?.team;
      if (!team) return;

      if (String(team) === String(playerTeam)) {
        playPointWin();
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      } else {
        playPointLose();
      }
    };

    const onEnd = (data) => {
      setGameOver(true);
      // If server provides finalScores, we keep local scores displayed but can show server too
      if (data?.finalScores && typeof data.finalScores === "object") {
        // no-op; keep compatibility, but we don't overwrite local player scores
      }
    };

    socket.on("flashcards-race:start", onStart);
    socket.on("flashcards-race:next", onNext);
    socket.on("flashcards-race:winner", onWinner);
    socket.on("flashcards-race:end", onEnd);

    return () => {
      socket.off("flashcards-race:start", onStart);
      socket.off("flashcards-race:next", onNext);
      socket.off("flashcards-race:winner", onWinner);
      socket.off("flashcards-race:end", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, secondsPerCard, playerTeam]);

  const normalize = (s) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const isCorrectAnswer = (input, correct) => {
    const a = normalize(input);
    const b = normalize(correct);
    if (!a || !b) return false;
    if (a === b) return true;

    // Allow numeric equivalence (e.g., "56" vs "56.0")
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na === nb) return true;

    // Allow very small typo tolerance for single-word answers (optional)
    if (b.split(" ").length === 1 && a.split(" ").length === 1) {
      const dist = levenshtein(a, b);
      if (dist <= 1 && b.length >= 5) return true;
    }
    return false;
  };

  const buzz = (playerIdx) => {
    if (disabled) return;
    if (gameOver) return;
    if (!currentCard) return;
    if (showShuffle) return;
    if (buzzedBy != null) return;
    if (attemptedPlayers.includes(playerIdx)) return;

    playBuzzer();
    setBuzzedBy(playerIdx);
    if (firstBuzzRef.current == null) firstBuzzRef.current = playerIdx;

    // If you later wire inter-team mode, emit a buzz event (best-effort; server may ignore)
    socket?.emit?.("flashcards-race:buzz", {
      roomCode,
      teamId: playerTeam?.id || playerTeam?.teamId || null,
      playerIdx,
      cardIndex,
      at: Date.now(),
    });
  };

  const submitAttempt = () => {
    if (disabled) return;
    if (gameOver) return;
    if (!currentCard) return;
    if (buzzedBy == null) return;

    const correct = isCorrectAnswer(answerText, currentCard.answer);

    setRoundWinners((prev) => [
      ...prev,
      {
        cardIndex,
        playerIndex: buzzedBy,
        correct,
        answer: answerText,
        expected: currentCard.answer,
      },
    ]);

    if (correct) {
      answeredThisCardRef.current = true;

      const isFirstBuzz = firstBuzzRef.current === buzzedBy;
      const earned = pointsCorrect + (isFirstBuzz ? pointsFirstBuzzBonus : 0);

      setScores((prev) => ({ ...prev, [buzzedBy]: (prev?.[buzzedBy] || 0) + earned }));

      playPointWin();
      confetti({ particleCount: 90, spread: 65, origin: { y: 0.62 } });

      // tell server (optional)
      socket?.emit?.("flashcards-race:answer", {
        roomCode,
        teamId: playerTeam?.id || playerTeam?.teamId || null,
        playerIdx: buzzedBy,
        cardIndex,
        answer: answerText,
        correct: true,
        earned,
        at: Date.now(),
      });

      // advance after a short win moment
      setTimeout(() => nextCard(), 650);
    } else {
      playPointLose();

      // tell server (optional)
      socket?.emit?.("flashcards-race:answer", {
        roomCode,
        teamId: playerTeam?.id || playerTeam?.teamId || null,
        playerIdx: buzzedBy,
        cardIndex,
        answer: answerText,
        correct: false,
        earned: 0,
        at: Date.now(),
      });

      setAttemptedPlayers((prev) => [...prev, buzzedBy]);
      setBuzzedBy(null);
      setAnswerText("");
      // timer resumes with remaining time
    }
  };

  const nextCard = () => {
    setShowShuffle(true);
    playShuffle();

    setTimeout(() => {
      setShowShuffle(false);
      setBuzzedBy(null);
      setAttemptedPlayers([]);
      setAnswerText("");
      firstBuzzRef.current = null;
      answeredThisCardRef.current = false;

      setCardIndex((prev) => {
        const next = prev + 1;
        if (next >= cards.length) {
          finishGame();
          return prev;
        }
        return next;
      });

      setTimeLeft(secondsPerCard);
    }, 650);
  };

  const finishGame = () => {
    setGameOver(true);

    const ranked = Object.entries(scores)
      .map(([k, v]) => ({ playerIndex: Number(k), score: Number(v) }))
      .filter((x) => Number.isFinite(x.playerIndex))
      .sort((a, b) => b.score - a.score);

    const top = ranked[0]?.playerIndex ?? null;

    const snapshot = {
      kind: "flashcards-race",
      roomCode: roomCode || null,
      teamId: playerTeam?.id || playerTeam?.teamId || null,
      playerCount,
      playerLabels,
      scores,
      winnerPlayerIndex: top,
      rounds: roundWinners,
      cardsUsed: cards.map((c, i) => ({ index: i, question: c.question, answer: c.answer })),
      pointsCorrect,
      pointsFirstBuzzBonus,
      secondsPerCard,
      completed: true,
    };

    onSubmit?.(snapshot);
    socket?.emit?.("flashcards-race:complete", snapshot);
  };

  const sortedLeaderboard = useMemo(() => {
    return playerLabels
      .map((name, idx) => ({ idx, name, score: scores?.[idx] || 0 }))
      .slice(0, playerCount)
      .sort((a, b) => b.score - a.score);
  }, [playerLabels, scores, playerCount]);

  const title = "🏁 Flashcards Race";

  return (
    <div
      className="h-full flex flex-col"
      style={{
        borderRadius: 18,
        border: "1px solid rgba(148,163,184,0.55)",
        background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 60%)",
        padding: 14,
        color: "#0f172a",
        boxShadow: "0 10px 28px rgba(15,23,42,0.06)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>{title}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Pill text={`${Math.min(cardIndex + 1, cards.length)}/${Math.max(cards.length, 1)} cards`} />
          {!gameOver && <Pill text={`⏱ ${timeLeft}s`} tone={timeLeft <= 5 ? "danger" : "neutral"} />}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, marginTop: 12, display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
        {/* Main card */}
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(203,213,225,0.7)",
            background: "#ffffff",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {showShuffle ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem" }}>🃏</div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>Shuffling…</div>
                <div style={{ color: "#64748b", fontSize: "0.95rem", marginTop: 4 }}>
                  Get ready to buzz!
                </div>
              </div>
            </div>
          ) : gameOver ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2.2rem" }}>🏆</div>
                <div style={{ fontWeight: 950, fontSize: "1.2rem", marginTop: 6 }}>Race complete!</div>
                <div style={{ color: "#475569", marginTop: 6 }}>
                  Winner:{" "}
                  <span style={{ fontWeight: 900 }}>
                    {sortedLeaderboard[0]?.name || "—"}
                  </span>
                </div>
                <div style={{ color: "#64748b", marginTop: 8, fontSize: "0.95rem" }}>
                  Waiting for your next task… Get ready to Curriculate!
                </div>
              </div>
            </div>
          ) : currentCard ? (
            <>
              <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>Question</div>
              <div
                style={{
                  marginTop: 10,
                  padding: 14,
                  borderRadius: 18,
                  background: "linear-gradient(180deg, rgba(14,165,233,0.12) 0%, rgba(99,102,241,0.08) 100%)",
                  border: "1px solid rgba(99,102,241,0.20)",
                  fontSize: "1.35rem",
                  fontWeight: 900,
                  lineHeight: 1.15,
                  flex: "0 0 auto",
                }}
              >
                {currentCard.question}
              </div>

              <div style={{ marginTop: 12, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>
                  {buzzedBy == null ? "Buzz in!" : `${playerLabels[buzzedBy] || "Player"} answers`}
                </div>

                {buzzedBy == null ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {playerLabels.slice(0, playerCount).map((name, idx) => (
                      <button
                        key={`buzz:${idx}`}
                        type="button"
                        onClick={() => buzz(idx)}
                        disabled={disabled || attemptedPlayers.includes(idx)}
                        style={{
                          padding: "12px 12px",
                          borderRadius: 18,
                          border: attemptedPlayers.includes(idx)
                            ? "1px solid rgba(148,163,184,0.65)"
                            : "1px solid rgba(14,165,233,0.45)",
                          background: attemptedPlayers.includes(idx)
                            ? "#f1f5f9"
                            : "linear-gradient(180deg, #ffffff 0%, #eff6ff 100%)",
                          fontWeight: 950,
                          cursor: disabled ? "not-allowed" : "pointer",
                          boxShadow: attemptedPlayers.includes(idx)
                            ? "none"
                            : "0 10px 22px rgba(14,165,233,0.10)",
                        }}
                        title={attemptedPlayers.includes(idx) ? "Already tried this card" : "Tap to buzz"}
                      >
                        🔔 {name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      disabled={disabled}
                      placeholder="Type the answer…"
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 16,
                        border: "1px solid rgba(148,163,184,0.65)",
                        fontSize: "1.05rem",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitAttempt();
                        }
                      }}
                      autoFocus
                    />

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={submitAttempt}
                        disabled={disabled || !String(answerText || "").trim()}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 999,
                          border: "none",
                          background: !String(answerText || "").trim() ? "#94a3b8" : "#16a34a",
                          color: "#ffffff",
                          fontWeight: 950,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        Submit ✅
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAttemptedPlayers((prev) => [...prev, buzzedBy]);
                          setBuzzedBy(null);
                          setAnswerText("");
                        }}
                        disabled={disabled}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 999,
                          border: "1px solid rgba(148,163,184,0.65)",
                          background: "#ffffff",
                          color: "#0f172a",
                          fontWeight: 900,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                        title="Pass (lets someone else buzz)"
                      >
                        Pass ↩
                      </button>

                      <div style={{ color: "#64748b", fontWeight: 800 }}>
                        Bonus: +{pointsFirstBuzzBonus} for first-buzz correct
                      </div>
                    </div>

                    <div style={{ color: "#64748b", fontSize: "0.95rem" }}>
                      Tip: Answer fast — the timer resumes if you miss!
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12, color: "#64748b", fontSize: "0.92rem", fontWeight: 700 }}>
                {localMode ? "Local race mode" : "Live race mode"} • +{pointsCorrect} per correct
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem" }}>📭</div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>No flashcards provided</div>
                <div style={{ color: "#64748b", marginTop: 6 }}>
                  This task needs config.items with at least 5 Q/A cards.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(203,213,225,0.7)",
            background: "#ffffff",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 10 }}>Leaderboard</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sortedLeaderboard.slice(0, playerCount).map((p, rank) => (
              <div
                key={`lb:${p.idx}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.35)",
                  background: rank === 0 ? "rgba(34,197,94,0.10)" : "#f8fafc",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 12,
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 950,
                      background: rank === 0 ? "rgba(34,197,94,0.18)" : "rgba(14,165,233,0.14)",
                      border: "1px solid rgba(148,163,184,0.35)",
                      flex: "0 0 auto",
                    }}
                  >
                    {rank + 1}
                  </div>
                  <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                </div>
                <div style={{ fontWeight: 950 }}>{p.score}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed rgba(148,163,184,0.6)", color: "#64748b", fontSize: "0.92rem" }}>
            {gameOver
              ? "Nice work — scan for your next station when prompted."
              : "Fast recall wins. Buzz smart!"}
          </div>

          {!gameOver && localMode && cards.length > 0 && (
            <button
              type="button"
              onClick={() => finishGame()}
              disabled={disabled}
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.65)",
                background: "#ffffff",
                color: "#0f172a",
                fontWeight: 900,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
              title="End early (sends a completion snapshot)"
            >
              End Race (early)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Small UI helpers
   ───────────────────────────────────────────── */

function Pill({ text, tone = "neutral" }) {
  const styles =
    tone === "danger"
      ? { background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.35)", color: "#991b1b" }
      : { background: "rgba(14,165,233,0.10)", border: "1px solid rgba(14,165,233,0.35)", color: "#0f172a" };

  return (
    <div
      style={{
        padding: "5px 10px",
        borderRadius: 999,
        fontWeight: 900,
        fontSize: "0.9rem",
        ...styles,
      }}
    >
      {text}
    </div>
  );
}

// Tiny Levenshtein for single-word tolerance
function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}
