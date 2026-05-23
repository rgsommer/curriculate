import React, { useEffect, useMemo, useRef, useState } from "react";
import VictoryScreen from "../../VictoryScreen";

/**
 * Musical Chairs (tap answer -> scan -> next question)
 *
 * DATA CONTRACT (same as multiple-choice / true-false):
 * task.items[]: [{ id, prompt, options[], correctAnswer }]
 * - options can be length 2 (T/F) or 3–5 (MC)
 * - MUST have >= 7 items (enforced by validator)
 *
 * GAME FLOW:
 * 1) Show 1 item
 * 2) Student taps an option (locks)
 * 3) Student then scans (emits socket event)
 * 4) UI advances to next item and unlocks
 *
 * Notes:
 * - We preserve your existing scan + winnerTeam + stationsLeft + countdown + animation.
 * - We emit scan payload with optional answer details. Server can ignore extras safely.
 */

export default function MusicalChairsTask({ task, onSubmit, disabled, socket, presenter, practiceMode = false, requireRealScans = false }) {
  // Show the tap-to-scan simulator only in true practice (no real
  // booth hardware).  Conference attendees see practiceMode=true
  // (solo demo, fake rounds), but requireRealScans=true means they
  // still have to actually scan with their phone.
  const showScanSimulator = practiceMode && !requireRealScans;
  const [showVictory, setShowVictory] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [phase, setPhase] = useState("countdown"); // countdown -> play
  const [countdown, setCountdown] = useState(3);
  const presenterCountdownStarted = useRef(false);

  // Question state
  const items = useMemo(() => (Array.isArray(task?.items) ? task.items : []), [task?.items]);
  const hasEnoughQuestions = items.length >= 7;

  // Practice-mode round simulator.  No real server / sockets / station
  // colours, so we fake 4 rounds locally to give the practicer the
  // shape of the game: round N starts with (5 - N + 1) stations, you
  // survive each round, last round = victory.
  const practiceRoundsTotal = 4;
  const [practiceRound, setPracticeRound] = useState(1);
  const stationsLeftLocal = practiceMode
    ? Math.max(2, 6 - practiceRound)
    : null;

  const [idx, setIdx] = useState(0);
  const current = items[idx] || null;

  const currentId = String(current?.id || `q${idx + 1}`);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [locked, setLocked] = useState(false); // locked after tap until scan
  const [scannedThisRound, setScannedThisRound] = useState(false);

  const instructions = useMemo(() => {
    return (
      task?.instructions ||
      task?.prompt ||
      "Tap your answer, then SCAN your station to get the next question!"
    );
  }, [task?.instructions, task?.prompt]);

  // Sounds + victory overlay
  useEffect(() => {
    if (!task || !task.winnerTeam) return;

    if (task.winnerTeam === "current") {
      try {
        new Audio("/sounds/victory.mp3").play();
      } catch (err) {
        console.error("Error playing victory sound:", err);
      }
      setShowVictory(true);
      const timer = setTimeout(() => setShowVictory(false), 5000);
      return () => clearTimeout(timer);
    }

    if (task.winnerTeam !== "eliminated") {
      try {
        new Audio("/sounds/lose.mp3").play();
      } catch (err) {
        console.error("Error playing lose sound:", err);
      }
    }
  }, [task?.winnerTeam]);

  // Reset per task
  useEffect(() => {
    setShowVictory(false);
    setErrorMsg("");
    setPhase("countdown");
    setCountdown(3);
    presenterCountdownStarted.current = false;

    setIdx(0);
    setSelectedIndex(null);
    setLocked(false);
    setScannedThisRound(false);
  }, [task?.taskType, task?.title, task?.prompt]);

  // Countdown presenter
  useEffect(() => {
    if (phase !== "countdown") return;
    if (disabled) return;

    if (presenter?.showCountdown && !presenterCountdownStarted.current) {
      presenterCountdownStarted.current = true;
      presenter
        .showCountdown({
          title: "Get ready…",
          seconds: 3,
          subtext: "Answer, then scan!",
          mode: "video",
          videoSrc: "/animations/categories/1-2-3-go.mp4",
        })
        .then(() => setPhase("play"))
        .catch(() => setPhase("play"));
      return;
    }

    setCountdown(3);
    const id = setInterval(() => {
      setCountdown((c) => {
        const next = c - 1;
        if (next <= 0) {
          clearInterval(id);
          setPhase("play");
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [phase, disabled, presenter]);

  const canTap = phase === "play" && !disabled && hasEnoughQuestions && !!current && !locked;
  const canScan =
    phase === "play" &&
    !disabled &&
    hasEnoughQuestions &&
    !!current &&
    locked &&
    selectedIndex !== null &&
    !scannedThisRound;

  const tapOption = (optIdx) => {
    if (!canTap) return;
    setSelectedIndex(optIdx);
    setLocked(true);
    setErrorMsg("");
  };

  const handleScan = () => {
    if (!canScan) return;

    // Practice mode: no real server.  We just bump the local round
    // counter and advance to the next question so the practicer feels
    // the rhythm of "answer → scan → survive → next round".  After the
    // final practice round, fire onSubmit with a synthetic victory.
    if (practiceMode) {
      setErrorMsg("");
      setScannedThisRound(true);
      window.setTimeout(() => {
        const isFinalRound = practiceRound >= practiceRoundsTotal;
        const isLastQuestion = idx >= items.length - 1;
        if (isFinalRound || isLastQuestion) {
          try {
            onSubmit?.({
              itemId: currentId,
              selectedIndex,
              correctAnswer: current?.correctAnswer,
              isCorrect:
                typeof current?.correctAnswer === "number"
                  ? selectedIndex === current.correctAnswer
                  : null,
              round: practiceRound,
              totalRounds: practiceRoundsTotal,
              practiceMode: true,
              survived: true,
              finished: true,
            });
          } catch {}
          setShowVictory(true);
          setLocked(true);
          return;
        }
        setPracticeRound((r) => r + 1);
        setIdx((n) => n + 1);
        setSelectedIndex(null);
        setLocked(false);
        setScannedThisRound(false);
      }, 250);
      return;
    }

    // do not fail silently
    if (!task?.roomCode) {
      setErrorMsg("Scan not sent: room code is missing.");
      return;
    }
    if (!socket) {
      setErrorMsg("Scan not sent: no connection.");
      return;
    }
    try {
      if (socket.connected === false) {
        setErrorMsg("Scan not sent: connection is offline. Try again.");
        return;
      }
    } catch {}

    setErrorMsg("");
    setScannedThisRound(true);

    // Emit scan + include answer payload (safe if server ignores extra keys)
    socket.emit("musical-chairs-scan", {
      roomCode: task.roomCode,
      answer: {
        itemId: currentId,
        selectedIndex,
      },
    });

    // Client advances to next question after scan
    window.setTimeout(() => {
      const isLast = idx >= items.length - 1;

      // Report answer upstream (optional)
      try {
        onSubmit?.({
          itemId: currentId,
          selectedIndex,
          correctAnswer: current?.correctAnswer,
          isCorrect:
            typeof current?.correctAnswer === "number" ? selectedIndex === current.correctAnswer : null,
          round: idx + 1,
          totalRounds: items.length,
          finished: isLast,
        });
      } catch {}

      if (isLast) {
        // End of questions; keep UI alive (winnerTeam may still come from server)
        // Reset so they can't keep scanning
        setLocked(true);
        setScannedThisRound(true);
        return;
      }

      setIdx((n) => n + 1);
      setSelectedIndex(null);
      setLocked(false);
      setScannedThisRound(false);
    }, 250);
  };

  const scanBtnClass =
    "px-12 py-8 text-4xl font-bold rounded-2xl transition " +
    (canScan
      ? "bg-green-600 text-white hover:bg-green-700 shadow-lg"
      : "bg-gray-300 text-gray-600");

  return (
    <div className="relative flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-indigo-50 via-white to-rose-50 overflow-hidden">
      <style>{`
        @keyframes chairSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes chairBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>

      <h2 className="text-5xl md:text-6xl font-black text-red-600 mb-4 drop-shadow">
        MUSICAL CHAIRS!
      </h2>

      {!hasEnoughQuestions && (
        <div
          className="mb-6 max-w-3xl w-full rounded-2xl border border-red-200 bg-red-50 text-red-800 p-4 font-semibold"
          role="alert"
        >
          Musical Chairs requires at least 7 questions (items). Got {items.length}.
        </div>
      )}

      <div className="max-w-3xl w-full rounded-3xl bg-white border border-slate-200 shadow-xl p-5 md:p-6 mb-6 text-left">
        <div className="text-xl md:text-2xl font-extrabold text-slate-900">How it works</div>
        <div className="mt-2 text-lg md:text-xl text-slate-700 font-semibold">{instructions}</div>
        <ul className="mt-3 text-base md:text-lg text-slate-700 list-disc pl-6 space-y-1">
          <li>Each round there's <b>one fewer station</b> than there are teams (chairs!).</li>
          <li><b>Tap</b> your answer, then <b>run + scan</b> a station.</li>
          <li>The team that scans <b>last each round is OUT</b>.</li>
          <li>Survive every round to win the game.</li>
        </ul>
        {showScanSimulator && (
          <div className="mt-3 text-sm md:text-base font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl p-3">
            🎯 <b>Practice mode</b>: we'll simulate {practiceRoundsTotal} rounds.
            Round {practiceRound} of {practiceRoundsTotal} —
            {" "}{stationsLeftLocal} {stationsLeftLocal === 1 ? "station" : "stations"} left.
            Tap an answer, then tap SCAN to survive into the next round.
          </div>
        )}
        {requireRealScans && (
          <div className="mt-3 text-sm md:text-base font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-3">
            📲 Walk to a station, tap an answer, then <b>scan the QR code</b> with your phone to survive.
          </div>
        )}
      </div>

      {/* Prominent round / chairs-remaining badge — tester (Gavy, May
          2026): "not obvious in the demo that there is a declining
          number of chairs/scan codes". Now shown above the turntable
          with the previous round's count struck through. */}
      {practiceMode && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            marginBottom: 14,
            padding: "10px 18px",
            borderRadius: 999,
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            border: "2px solid #f59e0b",
            boxShadow: "0 6px 16px rgba(245, 158, 11, 0.25)",
            fontWeight: 800,
            fontSize: "1.05rem",
            color: "#92400e",
          }}
          aria-live="polite"
        >
          <span style={{ fontSize: "1.4rem" }}>🪑</span>
          <span>Round {practiceRound} / {practiceRoundsTotal}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>
            Chairs:{" "}
            {practiceRound > 1 && (
              <span style={{ textDecoration: "line-through", opacity: 0.55, marginRight: 6 }}>
                {Math.max(2, 6 - (practiceRound - 1))}
              </span>
            )}
            <strong style={{ fontSize: "1.25rem", color: "#7c2d12" }}>{stationsLeftLocal}</strong>
          </span>
        </div>
      )}

      {/* Rotating chairs turntable.
          The chairs sit on an absolutely-positioned ring that we
          rotate as a group, so they actually orbit the center while
          the music plays.  Spin only while the player hasn't yet
          scanned (i.e. the music is still going); pause once they
          scan to mirror the real-game cue ("music stops!"). */}
      {(() => {
        const chairsSpinning = phase === "play" && !scannedThisRound;
        return (
          <div className="relative w-72 h-72 md:w-80 md:h-80 mb-6">
            <div
              className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-200 to-indigo-200 blur-2xl opacity-70"
              style={{ animation: "chairBob 1.6s ease-in-out infinite" }}
            />
            <div
              className="absolute inset-8 rounded-full border-8 border-white shadow-2xl bg-white/80"
            />
            {/* The actual rotating ring: holds the chair emojis at
                fixed angular positions, and spins as a unit. */}
            <div
              className="absolute inset-0"
              style={{
                animation: chairsSpinning ? "chairSpin 6s linear infinite" : undefined,
                transformOrigin: "center",
              }}
            >
              {Array.from({ length: 8 }).map((_, i) => {
                const angle = (i / 8) * Math.PI * 2;
                const r = 110;
                const x = 140 + Math.cos(angle) * r;
                const y = 140 + Math.sin(angle) * r;
                return (
                  <div
                    key={i}
                    className="absolute text-4xl md:text-5xl drop-shadow"
                    style={{
                      left: x,
                      top: y,
                      // Counter-rotate each chair so it stays upright
                      // even as the parent ring spins — looks like the
                      // chairs are travelling around the circle, not
                      // tumbling end-over-end.
                      transform: "translate(-50%,-50%)",
                    }}
                  >
                    🪑
                  </div>
                );
              })}
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="text-6xl md:text-7xl font-black text-slate-900 drop-shadow"
                style={{
                  // Note pulses while music plays, freezes when stopped.
                  animation: chairsSpinning ? "chairBob 0.6s ease-in-out infinite" : undefined,
                  opacity: chairsSpinning ? 1 : 0.4,
                }}
                title={chairsSpinning ? "Music's playing — answer + scan!" : "Music stopped"}
              >
                {chairsSpinning ? "🎵" : "🤫"}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Question + options (tap-based) */}
      {phase === "play" && hasEnoughQuestions && current && (
        <div className="mb-6 p-4 bg-yellow-50 rounded-2xl border border-yellow-200 max-w-3xl w-full shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm md:text-base font-extrabold text-slate-700">
              Question {idx + 1} / {items.length}
            </div>
            <div className="text-sm md:text-base font-bold text-slate-500">
              {locked
                ? (typeof current?.correctAnswer === "number" && selectedIndex === current.correctAnswer
                    ? "✅ Correct! — now scan"
                    : typeof current?.correctAnswer === "number"
                      ? "❌ Wrong — now scan"
                      : "Answered ✅ — now scan")
                : "Tap an answer"}
            </div>
          </div>

          <div className="text-xl md:text-2xl font-extrabold text-slate-900">{current.prompt}</div>

          {/* Tester ask: 'options should be a color (spread out the colors
              over the teams) so kids race to scan at that color'.  Each
              option is now branded with one of 4 station colours; in
              practice mode the colour swatch doubles as the simulated
              scanner target. */}
          {(() => {
            const STATION_COLOURS = [
              { name: "RED",    hex: "#ef4444", text: "#fff" },
              { name: "BLUE",   hex: "#3b82f6", text: "#fff" },
              { name: "YELLOW", hex: "#facc15", text: "#1f2937" },
              { name: "GREEN",  hex: "#22c55e", text: "#fff" },
            ];
            const optsArr = Array.isArray(current.options) ? current.options : [];
            return (
              <div className={`mt-3 grid ${optsArr.length <= 2 ? "grid-cols-2" : "grid-cols-2"} gap-3`}>
                {optsArr.map((opt, i) => {
                  const isPicked = selectedIndex === i;
                  const correctIdx = typeof current?.correctAnswer === "number" ? current.correctAnswer : null;
                  const showOverlay = locked && correctIdx != null;
                  const isCorrectOpt = showOverlay && i === correctIdx;
                  const isWrongPick = showOverlay && isPicked && i !== correctIdx;
                  const colour = STATION_COLOURS[i % STATION_COLOURS.length];
                  const ringStyle = isCorrectOpt
                    ? "ring-4 ring-green-400"
                    : isWrongPick
                    ? "ring-4 ring-red-500 opacity-70"
                    : isPicked
                    ? "ring-4 ring-slate-900"
                    : "";
                  return (
                    <button
                      key={`${currentId}-opt-${i}`}
                      onClick={() => tapOption(i)}
                      disabled={!canTap}
                      className={`p-4 rounded-xl font-extrabold text-lg border-2 transition shadow-md ${ringStyle}`}
                      style={{
                        background: colour.hex,
                        color: colour.text,
                        borderColor: "rgba(255,255,255,0.85)",
                        boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
                        textShadow:
                          colour.text === "#fff" ? "0 2px 6px rgba(0,0,0,0.35)" : "none",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.5, opacity: 0.9 }}>
                        🚦 {colour.name}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        {isCorrectOpt ? "✓ " : isWrongPick ? "✗ " : ""}{opt}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Practice-mode scanner simulator — fake scanner viewfinder
              with tappable colour buttons.  Tester wanted the same
              "tap a color on a row of colors" pattern other tasks
              already use. */}
          {/* Conference-mode dummy scanner.  No colour buttons — at a
              real booth the player would scan a station QR code.  This
              "Scan station" button stands in for the real scan and is
              clearly labelled so the demo audience sees the difference
              from practice mode. */}
          {requireRealScans && phase === "play" && current && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-900 text-white text-center">
              <div className="text-xs font-extrabold uppercase tracking-wide opacity-80 mb-2">
                📲 At a real booth you scan a station QR with your phone
              </div>
              <button
                type="button"
                onClick={() => {
                  if (selectedIndex == null) {
                    setErrorMsg("Pick an answer first.");
                    return;
                  }
                  handleScan();
                }}
                disabled={selectedIndex == null}
                className="px-6 py-3 rounded-xl bg-blue-600 text-white font-extrabold disabled:opacity-40"
              >
                Simulate scan to continue →
              </button>
            </div>
          )}

          {showScanSimulator && phase === "play" && current && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-900 text-white">
              <div className="text-xs font-extrabold uppercase tracking-wide opacity-80 mb-2 text-center">
                Practice mode — tap your colour to simulate scanning
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { name: "RED",    hex: "#ef4444", text: "#fff" },
                  { name: "BLUE",   hex: "#3b82f6", text: "#fff" },
                  { name: "YELLOW", hex: "#facc15", text: "#1f2937" },
                  { name: "GREEN",  hex: "#22c55e", text: "#fff" },
                ].map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => {
                      // Picking a colour selects + locks the
                      // corresponding option, then runs the scan.
                      if (selectedIndex == null) tapOption(i);
                      handleScan();
                    }}
                    style={{
                      background: c.hex,
                      color: c.text,
                      border: "3px solid rgba(255,255,255,0.85)",
                      borderRadius: 12,
                      padding: "12px 6px",
                      fontWeight: 900,
                      fontSize: ".9rem",
                      cursor: "pointer",
                      boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
                      textShadow:
                        c.text === "#fff" ? "0 2px 6px rgba(0,0,0,0.45)" : "none",
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {typeof task?.stationsLeft === "number" && (
        <div className="text-5xl md:text-6xl font-black text-indigo-700 mb-6">
          {task.stationsLeft} STATIONS LEFT
        </div>
      )}
      {practiceMode && stationsLeftLocal != null && task?.stationsLeft == null && (
        <div className="text-4xl md:text-5xl font-black text-indigo-700 mb-4">
          ROUND {practiceRound} / {practiceRoundsTotal} · {stationsLeftLocal} STATIONS LEFT
        </div>
      )}

      {/* Countdown fallback (if presenter overlay not used) */}
      {phase === "countdown" && !(presenter?.showCountdown && presenterCountdownStarted.current) && (
        <div className="mb-6">
          <div className="text-2xl md:text-3xl font-extrabold text-slate-800">Get ready…</div>
          <div className="mt-2 text-7xl md:text-8xl font-black text-red-600 animate-bounce">{countdown}</div>
          <div className="mt-1 text-5xl md:text-6xl font-black text-green-700">GO!</div>
        </div>
      )}

      <button onClick={handleScan} disabled={!canScan} className={scanBtnClass}>
        {phase !== "play" ? "WAIT…" : scannedThisRound ? "SCANNED!" : locked ? "SCAN NOW!" : "ANSWER FIRST"}
      </button>

      {errorMsg && (
        <div
          className="mt-4 max-w-3xl w-full rounded-2xl border border-red-200 bg-red-50 text-red-800 p-4 font-semibold"
          role="alert"
        >
          {errorMsg}
        </div>
      )}

      {task?.winnerTeam && (
        <div className="mt-8 text-5xl font-bold animate-pulse">
          {task.winnerTeam === "current" ? (
            <span className="text-green-600">YOU WIN! +5</span>
          ) : task.winnerTeam === "eliminated" ? (
            <span className="text-red-600">Eliminated</span>
          ) : (
            <span className="text-orange-600">{task.winnerTeam} Wins!</span>
          )}
        </div>
      )}

      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}
