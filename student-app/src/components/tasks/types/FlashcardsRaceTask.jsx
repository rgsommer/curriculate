// student-app/src/components/tasks/types/FlashcardsRaceTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";

/**
 * Flashcards Race
 * - Inter-team: YES (race vs other teams via socket events)
 * - Intra-team rotation: NO (your team collaborates on one buzz/answer)
 *
 * Socket-driven (real session):
 *   - server emits: flashcards-race:start { cards, totalCards }
 *   - server emits: flashcards-race:next { card, cardIndex, totalCards }
 *   - server emits: flashcards-race:winner { winner, scores, cardIndex, totalCards }
 *   - server emits: flashcards-race:end { winner, scores, totalCards }
 *
 * Demo/local fallback:
 *   - If no socket OR roomCode === "DEMO" OR task.demoMode === true, runs locally.
 */
export default function FlashcardsRaceTask(props) {
  const { task, socket, roomCode, playerTeam, disabled, onSubmit, memberNames = [] } = props || {};

  const isDemoLocal = useMemo(() => {
    const rc = String(roomCode || "").trim().toUpperCase();
    return !socket || rc === "DEMO" || task?.demoMode === true;
  }, [socket, roomCode, task]);

  // Pad practice with bogus team-mates so per-player buzz buttons
  // demonstrate the multi-player flow.  Tester: 'add other player
  // names in practice'.
  const FRR_BOTS = ["Riley", "Quinn", "Avery"];
  const safeMembers = useMemo(() => {
    const real = (Array.isArray(memberNames) ? memberNames : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean);
    if (isDemoLocal && real.length < 3) {
      const me = real[0] || "You";
      return [me, ...FRR_BOTS.map((b) => `${b} (bot)`)];
    }
    return real;
  }, [memberNames, isDemoLocal]);

  const [cards, setCards] = useState(() => []);
  const [cardIndex, setCardIndex] = useState(0);
  const [card, setCard] = useState(null);
  const [totalCards, setTotalCards] = useState(0);

  const [phase, setPhase] = useState("waiting"); // waiting | show | buzzed | reveal | done
  const [secondsLeft, setSecondsLeft] = useState(null);

  const [buzzedBy, setBuzzedBy] = useState(null); // "you" | "other"
  const [answer, setAnswer] = useState("");
  const [winner, setWinner] = useState(null); // { teamId, teamName } or string
  const [scores, setScores] = useState({ you: 0, other: 0 });

  // If the timer runs out with no buzz (demo/local), the UI must not get stuck.
  // We reveal the answer and let the group tap "Next Card".
  const [timedOut, setTimedOut] = useState(false);

  const tickRef = useRef(null);

  const youName = playerTeam?.teamName || "Your Team";
  const otherName = "Other Teams";

  const pointsPerCard = 10;
  const firstBuzzBonus = 5;

  const sfx = useMemo(() => {
    const safe = (url, volume = 0.15) => {
      try {
        const a = new Audio(url);
        a.volume = volume;
        a.play().catch(() => {});
      } catch {
        // ignore
      }
    };

    return {
      buzz: () =>
        safe("https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg", 0.18),
      correct: () =>
        safe("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg", 0.16),
      wrong: () => safe("https://actions.google.com/sounds/v1/cartoon/boing.ogg", 0.14),
      shuffle: () => safe("https://actions.google.com/sounds/v1/foley/card_shuffle.ogg", 0.14),
      win: () => safe("https://actions.google.com/sounds/v1/cartoon/ascending_whistle.ogg", 0.18),
      lose: () => safe("https://actions.google.com/sounds/v1/cartoon/concussive_hit_guitar_boing.ogg", 0.14),
      tick: () => safe("https://actions.google.com/sounds/v1/alarms/beep_short.ogg", 0.06),
      buzzer: () => safe("https://actions.google.com/sounds/v1/alarms/buzzer.ogg", 0.12),
    };
  }, []);

  const normalizedCards = useMemo(() => {
    const raw =
      (Array.isArray(task?.cards) && task.cards) ||
      (Array.isArray(task?.flashcards) && task.flashcards) ||
      (Array.isArray(task?.config?.cards) && task.config.cards) ||
      (Array.isArray(task?.config?.flashcards) && task.config.flashcards) ||
      [];
    const cleaned = raw
      .map((c, i) => ({
        id: c?.id || `card-${i}`,
        question: String(c?.question || c?.q || "").trim(),
        answer: String(c?.answer || c?.a || "").trim(),
      }))
      .filter((c) => c.question && c.answer);
    return cleaned;
  }, [task]);

  const fallbackCards = useMemo(
    () => [
      { id: "demo-1", question: "What is 7 × 8?", answer: "56" },
      { id: "demo-2", question: "Who discovered gravity (classic story)?", answer: "Isaac Newton" },
      { id: "demo-3", question: "Define ecosystem.", answer: "A community of living organisms interacting with their environment" },
      { id: "demo-4", question: "What is the capital of Canada?", answer: "Ottawa" },
      { id: "demo-5", question: "What is the value of π to 2 decimals?", answer: "3.14" },
      { id: "demo-6", question: "Name the first book of the Bible.", answer: "Genesis" },
    ],
    []
  );

  // ------------- helpers -------------
  function clearTimer() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function norm(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function isCorrect(student, correct) {
    const s = norm(student);
    const c = norm(correct);
    if (!s || !c) return false;
    if (s === c) return true;
    // tolerate small punctuation differences
    const strip = (x) => x.replace(/[^\w\s]/g, "");
    return strip(s) === strip(c);
  }

  function celebrate() {
    try {
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch {
      // ignore
    }
  }

  function finishGame(finalWinner, finalScores, total) {
    clearTimer();
    setPhase("done");
    setWinner(finalWinner);
    setScores(finalScores);
    setTotalCards(total ?? totalCards);

    // Notify TaskRunner / StudentApp so it can show review overlay + advance.
    try {
      if (typeof onSubmit === "function") {
        onSubmit({
          answer: {
            mode: isDemoLocal ? "demo" : "live",
            winner: finalWinner,
            scores: finalScores,
            totalCards: total ?? totalCards,
          },
        });
      }
    } catch {
      // ignore
    }
  }

  // ------------- socket wiring (live sessions) -------------
  useEffect(() => {
    if (!socket || isDemoLocal) return;

    const onStart = (payload) => {
      const incoming = Array.isArray(payload?.cards) ? payload.cards : [];
      const clean = incoming
        .map((c, i) => ({
          id: c?.id || `card-${i}`,
          question: String(c?.question || c?.q || "").trim(),
          answer: String(c?.answer || c?.a || "").trim(),
        }))
        .filter((c) => c.question && c.answer);

      setCards(clean);
      setTotalCards(Number(payload?.totalCards) || clean.length || 0);
      setCardIndex(0);
      setCard(clean[0] || null);
      setBuzzedBy(null);
      setAnswer("");
      setTimedOut(false);
      setWinner(null);
      setScores({ you: 0, other: 0 });
      setPhase(clean.length ? "show" : "waiting");
      setSecondsLeft(20);
      sfx.shuffle();
    };

    const onNext = (payload) => {
      const c = payload?.card || null;
      setCard({
        id: c?.id || `card-${payload?.cardIndex ?? 0}`,
        question: String(c?.question || c?.q || "").trim(),
        answer: String(c?.answer || c?.a || "").trim(),
      });
      setCardIndex(Number(payload?.cardIndex) || 0);
      setTotalCards(Number(payload?.totalCards) || totalCards);
      setBuzzedBy(null);
      setAnswer("");
      setTimedOut(false);
      setPhase("show");
      setSecondsLeft(20);
      sfx.shuffle();
    };

    const onWinner = (payload) => {
      // payload.winner may be { teamId, teamName } OR string
      const w = payload?.winner ?? null;
      const sc = payload?.scores || {};
      setWinner(w);
      setScores({
        you: Number(sc?.you ?? sc?.A ?? 0),
        other: Number(sc?.other ?? sc?.B ?? 0),
      });
      celebrate();
      sfx.win();
    };

    const onEnd = (payload) => {
      const w = payload?.winner ?? winner;
      const sc = payload?.scores || {};
      const finalScores = {
        you: Number(sc?.you ?? sc?.A ?? scores.you ?? 0),
        other: Number(sc?.other ?? sc?.B ?? scores.other ?? 0),
      };
      finishGame(w, finalScores, Number(payload?.totalCards) || totalCards);
    };

    socket.on("flashcards-race:start", onStart);
    socket.on("flashcards-race:next", onNext);
    socket.on("flashcards-race:winner", onWinner);
    socket.on("flashcards-race:end", onEnd);

    return () => {
      try {
        socket.off("flashcards-race:start", onStart);
        socket.off("flashcards-race:next", onNext);
        socket.off("flashcards-race:winner", onWinner);
        socket.off("flashcards-race:end", onEnd);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isDemoLocal]);

  // ------------- demo/local init -------------
  useEffect(() => {
    if (!isDemoLocal) return;

    const deck = (normalizedCards && normalizedCards.length ? normalizedCards : fallbackCards).slice(
      0,
      8
    );

    setCards(deck);
    setTotalCards(deck.length);
    setCardIndex(0);
    setCard(deck[0] || null);
    setBuzzedBy(null);
    setBuzzedByName("");
    setAnswer("");
    setTimedOut(false);
    setWinner(null);
    setScores({ you: 0, other: 0 });
    setPhase(deck.length ? "show" : "waiting");
    setSecondsLeft(deck.length ? 20 : null);
    sfx.shuffle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoLocal]);

  // ------------- countdown -------------
  useEffect(() => {
    clearTimer();

    if (phase !== "show" && phase !== "buzzed") return;
    if (disabled) return;
    if (typeof secondsLeft !== "number") return;

    tickRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = (typeof prev === "number" ? prev : 0) - 1;

        if (next <= 0) {
          clearTimer();
          sfx.buzzer();
          // Demo/local: if nobody buzzed before time, REVEAL and allow "Next Card".
          if (isDemoLocal && phase === "show") {
            setTimedOut(true);
            setBuzzedBy(null);
            setPhase("reveal");
            return 0;
          }
          setPhase((p) => (p === "show" ? "reveal" : p));
          return 0;
        }

        if (next <= 10) sfx.tick();
        return next;
      });
    }, 1000);

    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, disabled, isDemoLocal]);

  // ------------- actions (demo/local) -------------
  function nextCardOrFinish(nextScores) {
    const nextIdx = cardIndex + 1;
    if (nextIdx >= (totalCards || cards.length || 0)) {
      const w =
        (nextScores.you || 0) >= (nextScores.other || 0)
          ? { teamId: playerTeam?.id || "you", teamName: youName }
          : { teamId: "other", teamName: otherName };

      if ((nextScores.you || 0) >= (nextScores.other || 0)) {
        sfx.win();
        celebrate();
      } else {
        sfx.lose();
      }

      finishGame(w, nextScores, totalCards || cards.length);
      return;
    }

    setCardIndex(nextIdx);
    setCard(cards[nextIdx] || null);
    setBuzzedBy(null);
    setBuzzedByName("");
    setAnswer("");
    setTimedOut(false);
    setSecondsLeft(20);
    setPhase("show");
    sfx.shuffle();
  }

  // Track which named player buzzed in (when memberNames is populated).
  // Stored alongside the legacy "you"/"other" string used by the live
  // socket path so existing logic still works.
  const [buzzedByName, setBuzzedByName] = useState("");

  function buzzYou(playerName = "") {
    if (disabled) return;
    if (!isDemoLocal) return; // in live mode, server should manage buzz
    if (phase !== "show") return;
    setBuzzedBy("you");
    setBuzzedByName(playerName || "");
    setPhase("buzzed");
    sfx.buzz();
    try { if (navigator?.vibrate) navigator.vibrate(20); } catch {}
  }

  // Auto-focus the answer input the instant we enter the buzzed phase
  // so the player doesn't have to tap the box to start typing.
  const answerInputRef = useRef(null);
  useEffect(() => {
    if (phase === "buzzed" && buzzedBy === "you" && answerInputRef.current) {
      // Defer one tick so the input has rendered.
      requestAnimationFrame(() => {
        try { answerInputRef.current.focus(); } catch {}
      });
    }
  }, [phase, buzzedBy]);

  function submitAnswer() {
    if (disabled) return;
    if (!isDemoLocal) return;
    if (phase !== "buzzed") return;

    const ok = isCorrect(answer, card?.answer);
    const base = pointsPerCard;
    const bonus = firstBuzzBonus;

    if (ok) {
      sfx.correct();
      celebrate();
      const nextScores = {
        ...scores,
        you: (scores.you || 0) + base + bonus,
      };
      setScores(nextScores);
      setPhase("reveal");
      window.setTimeout(() => nextCardOrFinish(nextScores), 900);
    } else {
      sfx.wrong();
      // pass to other team (quick AI-ish attempt)
      setPhase("reveal");
      window.setTimeout(() => {
        const otherGetsIt = Math.random() < 0.6;
        const nextScores = otherGetsIt
          ? { ...scores, other: (scores.other || 0) + base }
          : scores;
        setScores(nextScores);
        window.setTimeout(() => nextCardOrFinish(nextScores), 600);
      }, 750);
    }
  }

  // ------------- styles -------------
  const shell = {
    position: "relative",
    width: "100%",
    minHeight: 520,
    borderRadius: 18,
    padding: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "radial-gradient(1200px 520px at 30% 0%, rgba(56,189,248,0.16), rgba(15,23,42,0.72) 55%, rgba(2,6,23,0.85))",
    color: "#e5e7eb",
    overflow: "hidden",
  };

  const header = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 12,
  };

  const title = {
    fontWeight: 1000,
    letterSpacing: 0.2,
    fontSize: "1.25rem",
    color: "#fff",
  };

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    background: "rgba(15,23,42,0.55)",
    border: "1px solid rgba(148,163,184,0.5)",
    color: "#e5e7eb",
  };

  const scorePill = (isYou) => ({
    ...pill,
    background: isYou ? "rgba(59,130,246,0.18)" : "rgba(0,0,0,0.20)",
  });

  const bigQ = {
    fontSize: "clamp(22px, 3.6vw, 40px)",
    fontWeight: 1000,
    lineHeight: 1.08,
    color: "#fff",
    textShadow: "0 2px 10px rgba(0,0,0,0.45)",
    marginTop: 10,
  };

  const cardBox = {
    marginTop: 14,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    padding: 16,
  };

  const btn = (variant) => ({
    border: "1px solid rgba(148,163,184,0.55)",
    background:
      variant === "primary"
        ? "linear-gradient(135deg, rgba(34,197,94,0.65), rgba(14,165,233,0.65))"
        : "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 1000,
    borderRadius: 999,
    padding: "10px 14px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  });

  // ------------- render -------------
  if (!card && phase === "waiting") {
    return (
      <div style={shell}>
        <div style={header}>
          <div style={title}>Flashcards Race</div>
          <span style={pill}>Waiting for the race…</span>
        </div>
        <div style={cardBox}>
          <div style={{ fontWeight: 900, opacity: 0.85 }}>
            Waiting for your next task… Get ready to Curriculate!
          </div>
        </div>
      </div>
    );
  }

  const progressText =
    totalCards > 0 ? `${Math.min(cardIndex + 1, totalCards)} / ${totalCards}` : "";

  const timerPercent =
    typeof secondsLeft === "number" ? Math.max(0, Math.min(100, Math.round((secondsLeft / 20) * 100))) : 0;

  return (
    <div style={shell}>
      {/* top glow */}
      <div
        style={{
          position: "absolute",
          inset: "-40% -10% auto -10%",
          height: 260,
          background:
            "radial-gradient(circle at 30% 50%, rgba(34,197,94,0.18), rgba(59,130,246,0.12), transparent 60%)",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />

      <div style={header}>
        <div>
          <div style={title}>Flashcards Race</div>
          <div style={{ opacity: 0.8, fontSize: 13, marginTop: 2 }}>
            Buzz in first. Answer fast. Win the card.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={pill}>Card: {progressText || "—"}</span>
          <span style={scorePill(true)}>
            {youName}: <span style={{ fontVariantNumeric: "tabular-nums" }}>{scores.you || 0}</span>
          </span>
          <span style={scorePill(false)}>
            {otherName}:{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{scores.other || 0}</span>
          </span>
        </div>
      </div>

      {/* timer bar */}
      {phase !== "done" && (
        <div style={{ marginTop: 6 }}>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "rgba(255,255,255,0.14)",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${timerPercent}%`,
                background: "rgba(255,255,255,0.85)",
                transition: "width 240ms linear",
              }}
            />
          </div>
          <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
            Time left:{" "}
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {typeof secondsLeft === "number" ? secondsLeft : "—"}s
            </strong>
          </div>
        </div>
      )}

      <div style={cardBox}>
        {phase === "done" ? (
          <div>
            <div style={{ fontWeight: 1000, fontSize: 22, color: "#fff" }}>
              Winner:{" "}
              <span style={{ color: "rgba(34,197,94,0.95)" }}>
                {winner?.teamName || String(winner || "") || youName}
              </span>
            </div>
            <div style={{ marginTop: 10, opacity: 0.85, fontWeight: 900 }}>
              Great race. The session will advance automatically.
            </div>
          </div>
        ) : (
          <>
            {/* Card-style question wrapper — proper playing-card
                proportions (~30% of available width on desktop, taller
                than wide).  Animated tilt-in so it feels dealt. */}
            <div
              key={`card-${cardIndex}`}
              style={{
                position: "relative",
                margin: "8px auto",
                width: "min(30vw, 360px)",
                minWidth: 220,
                aspectRatio: "5 / 7",        // playing-card proportions
                borderRadius: 22,
                padding: "28px 18px 22px",
                background: "linear-gradient(180deg, #ffffff, #f8fafc)",
                color: "#0f172a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow:
                  "0 28px 50px rgba(15,23,42,0.45), inset 0 0 0 1px rgba(15,23,42,0.05), inset 0 -4px 0 rgba(15,23,42,0.06)",
                animation: "fcDeal 0.45s cubic-bezier(0.2,0.8,0.2,1) both",
              }}
            >
              <style>{`
                @keyframes fcDeal {
                  0% { transform: translateY(-30px) rotate(-6deg) scale(0.92); opacity: 0; }
                  60% { transform: translateY(4px) rotate(1deg) scale(1.02); opacity: 1; }
                  100% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
                }
              `}</style>
              <div
                style={{
                  position: "absolute", top: 12, left: 16,
                  fontSize: 11, fontWeight: 900, letterSpacing: 1.5,
                  color: "rgba(15,23,42,0.45)", textTransform: "uppercase",
                }}
              >
                Card {cardIndex + 1} / {totalCards}
              </div>
              <div style={{ ...bigQ, color: "#0f172a", textAlign: "center", marginTop: 14 }}>
                {card?.question}
              </div>
            </div>

            {phase === "show" && (
              <div style={{ marginTop: 14 }}>
                {!isDemoLocal ? (
                  <div style={{ opacity: 0.8, fontWeight: 900 }}>
                    Live race: waiting for server buzz/next events…
                  </div>
                ) : safeMembers.length > 0 ? (
                  // Per-player buzz buttons.  First name to buzz gets to
                  // answer (+5 bonus); the rest of the team can still
                  // help out loud.
                  <>
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>
                      Whoever knows it first — buzz in!
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {safeMembers.map((name) => (
                        <button
                          key={name}
                          type="button"
                          style={btn("primary", { fontSize: 18, padding: "14px 18px", borderRadius: 16 })}
                          onClick={() => buzzYou(name)}
                          disabled={disabled}
                        >
                          🔔 Buzz {name}
                        </button>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, opacity: 0.75, fontWeight: 800, fontSize: 12 }}>
                      First to buzz gets to answer (+{firstBuzzBonus} bonus).
                    </div>
                  </>
                ) : (
                  // Fallback when we don't know team-member names.
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={btn("primary", { fontSize: 28, padding: "18px 22px", borderRadius: 18 })}
                      onClick={() => buzzYou("")}
                      disabled={disabled}
                    >
                      🔔 Buzz!
                    </button>
                    <div style={{ opacity: 0.8, fontWeight: 900, alignSelf: "center" }}>
                      First to buzz gets to answer (+{firstBuzzBonus} bonus).
                    </div>
                  </div>
                )}
              </div>
            )}

            {phase === "buzzed" && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 1000, marginBottom: 8 }}>
                  {buzzedBy === "you"
                    ? (buzzedByName
                        ? `${buzzedByName} buzzed first!`
                        : "You buzzed first!")
                    : "Other team buzzed first!"}
                </div>

                {buzzedBy === "you" ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      ref={answerInputRef}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter submits — saves a tap, tester request.
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitAnswer();
                        }
                      }}
                      placeholder={
                        buzzedByName ? `${buzzedByName}, type your answer…` : "Type your answer…"
                      }
                      disabled={disabled}
                      autoFocus
                      style={{
                        flex: "1 1 320px",
                        minWidth: 240,
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(148,163,184,0.55)",
                        background: "rgba(15,23,42,0.85)",
                        color: "#fff",
                        fontWeight: 900,
                        outline: "none",
                      }}
                    />
                    <button type="button" style={btn("primary")} onClick={submitAnswer} disabled={disabled}>
                      Submit (↵)
                    </button>
                  </div>
                ) : (
                  <div style={{ opacity: 0.8, fontWeight: 900 }}>
                    Waiting for their answer…
                  </div>
                )}
              </div>
            )}

            {phase === "reveal" && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>Answer:</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 1000,
                    color: "#fff",
                    marginTop: 6,
                    textShadow: "0 1px 10px rgba(0,0,0,0.4)",
                  }}
                >
                  {card?.answer}
                </div>
                {isDemoLocal ? (
                  <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      style={btn("primary", { fontSize: 22, padding: "14px 18px", borderRadius: 16 })}
                      onClick={() => nextCardOrFinish(scores)}
                      disabled={disabled}
                    >
                      ➜ Next Card
                    </button>
                    {timedOut ? (
                      <div style={{ opacity: 0.85, fontWeight: 900 }}>
                        Time ran out — flip, discuss, and move on.
                      </div>
                    ) : (
                      <div style={{ opacity: 0.75, fontSize: 13, fontWeight: 800 }}>
                        Keep it honest: tap Next when the group agrees who got it.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13, fontWeight: 800 }}>
                    Waiting for the next card…
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {disabled ? (
        <div style={{ position: "absolute", bottom: 12, right: 14, opacity: 0.65, fontWeight: 900 }}>
          Locked…
        </div>
      ) : null}
    </div>
  );
}
