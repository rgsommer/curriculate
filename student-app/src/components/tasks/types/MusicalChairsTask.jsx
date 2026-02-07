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

export default function MusicalChairsTask({ task, onSubmit, disabled, socket, presenter }) {
  const [showVictory, setShowVictory] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [phase, setPhase] = useState("countdown"); // countdown -> play
  const [countdown, setCountdown] = useState(3);
  const presenterCountdownStarted = useRef(false);

  // Question state
  const items = useMemo(() => (Array.isArray(task?.items) ? task.items : []), [task?.items]);
  const hasEnoughQuestions = items.length >= 7;

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
        // Reset so they can’t keep scanning
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

      <div className="max-w-3xl w-full rounded-3xl bg-white border border-slate-200 shadow-xl p-5 md:p-6 mb-6">
        <div className="text-xl md:text-2xl font-extrabold text-slate-900">How it works</div>
        <div className="mt-2 text-lg md:text-xl text-slate-700 font-semibold">{instructions}</div>
        <div className="mt-3 text-base md:text-lg text-slate-500">
          Step 1: <span className="font-bold">TAP</span> your answer. Step 2: <span className="font-bold">SCAN</span>{" "}
          to get the next question.
        </div>
      </div>

      {/* Rotating chairs animation */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 mb-6">
        <div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-200 to-indigo-200 blur-2xl opacity-70"
          style={{ animation: "chairBob 1.6s ease-in-out infinite" }}
        />
        <div
          className="absolute inset-8 rounded-full border-8 border-white shadow-2xl bg-white/80"
          style={{ animation: "chairSpin 3.6s linear infinite" }}
        />
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const r = 110;
          const x = 140 + Math.cos(angle) * r;
          const y = 140 + Math.sin(angle) * r;
          return (
            <div
              key={i}
              className="absolute text-4xl md:text-5xl drop-shadow"
              style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}
            >
              🪑
            </div>
          );
        })}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-6xl md:text-7xl font-black text-slate-900 drop-shadow">🎵</div>
        </div>
      </div>

      {/* Question + options (tap-based) */}
      {phase === "play" && hasEnoughQuestions && current && (
        <div className="mb-6 p-4 bg-yellow-50 rounded-2xl border border-yellow-200 max-w-3xl w-full shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm md:text-base font-extrabold text-slate-700">
              Question {idx + 1} / {items.length}
            </div>
            <div className="text-sm md:text-base font-bold text-slate-500">
              {locked ? "Answered ✅ — now scan" : "Tap an answer"}
            </div>
          </div>

          <div className="text-xl md:text-2xl font-extrabold text-slate-900">{current.prompt}</div>

          <div
            className={`mt-3 grid ${
              (Array.isArray(current.options) ? current.options.length : 0) <= 2 ? "grid-cols-2" : "grid-cols-2"
            } gap-3`}
          >
            {(Array.isArray(current.options) ? current.options : []).map((opt, i) => {
              const isPicked = selectedIndex === i;
              const base =
                "p-4 rounded-xl font-bold text-lg border-2 transition shadow-sm";
              const cls = isPicked
                ? `${base} bg-slate-900 text-white border-slate-900`
                : `${base} bg-white text-slate-900 border-slate-200 hover:bg-slate-50`;
              return (
                <button
                  key={`${currentId}-opt-${i}`}
                  onClick={() => tapOption(i)}
                  disabled={!canTap}
                  className={cls}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {typeof task?.stationsLeft === "number" && (
        <div className="text-5xl md:text-6xl font-black text-indigo-700 mb-6">
          {task.stationsLeft} STATIONS LEFT
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
