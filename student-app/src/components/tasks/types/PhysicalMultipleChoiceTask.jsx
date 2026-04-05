// src/components/tasks/types/PhysicalMultipleChoiceTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Physical Multiple Choice Task – SINGLE global scanner (StudentApp)
 *
 * Receives scans via:
 *  - window event: "curriculate:stationScan" detail: { color, stationColor, stationId }
 *  - OR StudentApp calling: window.__curriculateTaskScanHandler(rawValue) => boolean
 *
 * Contract:
 *  - window.__curriculateTaskWantsScan = true only while waiting for an answer scan
 *  - handler returns true ONLY when an answer scan is accepted/consumed
 *
 * Also emits (optional UX hook for StudentApp):
 *  - "curriculate:pmcAnswerResult" detail: { accepted, correct, done }
 */

export default function PhysicalMultipleChoiceTask({
  task,
  onSubmit,
  disabled = false,
  mode = "play",
  excludedColor = null,
  excludedColors = null,
  onIncorrectScan = null,
}) {
  const isReview = mode === "review";

  const stationPalette = useMemo(() => {
    const cfg = task?.config?.stationColors;
    const legacy = task?.stationColors;
    return (
      (Array.isArray(cfg) && cfg.length >= 8 ? cfg : null) ||
      (Array.isArray(legacy) && legacy.length >= 8 ? legacy : null) ||
      ["Red", "Orange", "Yellow", "Green", "Blue", "Teal", "Purple", "Pink"]
    ).slice(0, 8);
  }, [task]);

  const items = useMemo(() => {
    if (Array.isArray(task?.items) && task.items.length > 0) return task.items;
    return [
      {
        prompt: task?.prompt ?? "",
        options: Array.isArray(task?.options) ? task.options : [],
        correctAnswer: task?.correctAnswer ?? null,
        __single: true,
      },
    ];
  }, [task]);

  const letters = ["A", "B", "C", "D"];
  const [qIndex, setQIndex] = useState(0);

  const [selectedLetterByQ, setSelectedLetterByQ] = useState({});
  const selectedLetterByQRef = useRef({});
  useEffect(() => {
    selectedLetterByQRef.current = selectedLetterByQ || {};
  }, [selectedLetterByQ]);

  const [showScannerPrompt, setShowScannerPrompt] = useState(true);
  const [showingFeedback, setShowingFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [scanError, setScanError] = useState("");

  const lastValidScanColorRef = useRef(null);
  const advanceTimerRef = useRef(null);
  const errorTimerRef = useRef(null);
  const flashTimerRef = useRef(null);

  const submittedOnceRef = useRef(false);

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  };
  const clearErrorTimer = () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = null;
  };

  const [flashColor, setFlashColor] = useState(null);
  const [wrongLettersByQ, setWrongLettersByQ] = useState({});

  const [streak, setStreak] = useState(0);
  const [streakBanner, setStreakBanner] = useState("");
  const streakTimerRef = useRef(null);

  const normalizeColor = (c) =>
    typeof c === "string" ? c.trim().toLowerCase() : "";

    useEffect(() => {
      // reset on new task
      setQIndex(0);
      setSelectedLetterByQ({});
      selectedLetterByQRef.current = {};
      setShowScannerPrompt(true);
      setShowingFeedback(false);
      setWrongLettersByQ({});
      setFeedbackMessage("");
      setScanError("");
      lastValidScanColorRef.current = null;
      submittedOnceRef.current = false;
      clearAdvanceTimer();
      clearErrorTimer();
      resetGlobalScanDedupe();
      setStreak(0);
      setStreakBanner("");
      clearStreakTimer();

      return () => {
        clearAdvanceTimer();
        clearErrorTimer();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task?._id]);

  const effectiveExclusions = useMemo(() => {
    const set = new Set();
    if (excludedColor) set.add(normalizeColor(excludedColor));
    if (Array.isArray(excludedColors)) {
      excludedColors.forEach((c) => {
        const n = normalizeColor(c);
        if (n) set.add(n);
      });
    }
    if (lastValidScanColorRef.current) set.add(normalizeColor(lastValidScanColorRef.current));
    return set;
  }, [excludedColor, excludedColors, qIndex]);

  function hashStringToSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(array, seed) {
    const rng = mulberry32(seed);
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  const currentMap = useMemo(() => {
    const teamSalt = (() => {
      try {
        return (
          localStorage.getItem("teamId") ||
          localStorage.getItem("curriculateTeamId") ||
          ""
        );
      } catch {
        return "";
      }
    })();

    const seedStr = `${teamSalt}-${task?.title || ""}-${qIndex}`;
    const seed = hashStringToSeed(seedStr);

    const available = stationPalette.filter((c) => !effectiveExclusions.has(normalizeColor(c)));
    const source = available.length >= 4 ? available : stationPalette;
    const shuffled = seededShuffle(source, seed);
    const selected = shuffled.slice(0, 4);

    return Object.fromEntries(letters.map((l, i) => [l, selected[i]]));
  }, [qIndex, task?.title, stationPalette]);

  const currentQuestion = items[qIndex] || {};
  const options = Array.isArray(currentQuestion.options) ? currentQuestion.options : [];
  const rawCorrectAnswer = currentQuestion?.correctAnswer;

  const resolveCorrectLetter = (value) => {
    if (typeof value === "number") {
      if (value >= 0 && value < letters.length) return letters[value];
      if (value >= 1 && value <= letters.length) return letters[value - 1];
      return null;
    }

    const s = String(value ?? "").trim().toUpperCase();

    if (letters.includes(s)) return s;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n >= 0 && n < letters.length) return letters[n];
      if (n >= 1 && n <= letters.length) return letters[n - 1];
    }

    return null;
  };

  const correctLetter = useMemo(() => {
    const resolved = resolveCorrectLetter(rawCorrectAnswer);
    if (!resolved) {
      console.warn("[PMC] Could not resolve correctLetter from:", rawCorrectAnswer);
    }
    return resolved;
  }, [rawCorrectAnswer, resolveCorrectLetter]);

  // Keep the global scanner alive throughout the task.
  // We gate acceptance inside acceptColorScan() so scans during feedback
  // or when we intentionally pause will be ignored.
  const wantsScan = !disabled && !isReview && showScannerPrompt && !showingFeedback;

  // Claim scans globally while waiting
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.__curriculateTaskWantsScan = wantsScan;
    return () => {
      if (window.__curriculateTaskWantsScan === wantsScan) {
        window.__curriculateTaskWantsScan = false;
      }
    };
  }, [wantsScan]);

  const emitAnswerResult = (accepted, correct, done) => {
    try {
      window.dispatchEvent(
        new CustomEvent("curriculate:pmcAnswerResult", {
          detail: { accepted, correct, done },
        })
      );
    } catch {}
  };

  const resetGlobalScanDedupe = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("curriculate:resetScanDedupe")
      );
    } catch {}
  };
  
  const acceptColorScan = (rawColorLike) => {
    console.log("[PMC entry gate]", {
      rawColorLike,
      disabled,
      isReview,
      showScannerPrompt,
      showingFeedback,
    });
    
    if (disabled || isReview || !showScannerPrompt || showingFeedback) return false;

    let scanned = rawColorLike;

    if (scanned && typeof scanned === "object") {
      scanned = scanned.color || scanned.stationColor || scanned.stationId || "";
    }

    if (typeof scanned === "string" && scanned.includes("play.curriculate.net/")) {
      const parts = scanned.split("/");
      scanned = parts[parts.length - 1];
    }

    const scannedNorm = normalizeColor(scanned);
    if (!scannedNorm) return false;

    console.log("[PMC match check]", {
      scannedNorm,
      currentMap,
      correctLetter,
      showScannerPrompt,
      showingFeedback,
      disabled,
      isReview,
    });

    const matchingLetter =
      Object.entries(currentMap).find(
        ([, color]) => normalizeColor(color) === scannedNorm
      )?.[0] || null;

    if (!matchingLetter) {
      setScanError("The last color scanned was not an option. Try again!");
      clearErrorTimer();
      errorTimerRef.current = setTimeout(() => setScanError(""), 1600);

      setFlashColor("yellow");
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashColor(null), 300);

      try { window.__curriculatePlayWrongSound?.(); } catch {}
      try { navigator.vibrate?.(120); } catch {}

      emitAnswerResult(false, false, false);
      return false;
    }

    // 🚨 Guard: if correct answer couldn't be resolved
    if (!correctLetter) {
      console.error("[PMC] No valid correctLetter:", rawCorrectAnswer);
      emitAnswerResult(true, false, false);
      return true;
    }

    const isCorrect = matchingLetter === correctLetter;

    console.log("[PMC DEBUG]", {
      scannedNorm,
      currentMap,
      matchingLetter,
      correctLetter,
      rawCorrectAnswer,
    });

    console.log("[PMC] scanned:", scannedNorm);
    console.log("[PMC] map:", currentMap);
    console.log("[PMC] matched:", matchingLetter);
    console.log("[PMC] correctLetter:", correctLetter);

    if (!isCorrect) {
      setSelectedLetterByQ((prev) => ({
        ...prev,
        [qIndex]: matchingLetter,
      }));

      setWrongLettersByQ((prev) => {
        const existing = prev[qIndex] || [];
        if (existing.includes(matchingLetter)) return prev;
        return {
          ...prev,
          [qIndex]: [...existing, matchingLetter],
        };
      });

      setShowScannerPrompt(false);
      setShowingFeedback(true);
      setFeedbackMessage("Incorrect — try again");

      setFlashColor("red");
      setStreak(0);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashColor(null), 300);

      try { window.__curriculatePlayWrongSound?.(); } catch {}
      try { navigator.vibrate?.([100, 60, 100]); } catch {}

      clearAdvanceTimer();
      advanceTimerRef.current = setTimeout(() => {
        setShowingFeedback(false);
        setFeedbackMessage("");
        setSelectedLetterByQ((prev) => ({
          ...prev,
          [qIndex]: null,
        }));
        resetGlobalScanDedupe();
        setShowScannerPrompt(true);

        emitAnswerResult(true, false, false);
      }, Number(task?.config?.feedbackDelay ?? 1200) || 1200);

      return true;
    }

    lastValidScanColorRef.current = scannedNorm;

    const nextSelected = {
      ...(selectedLetterByQRef.current || {}),
      [qIndex]: matchingLetter,
    };
    setSelectedLetterByQ(nextSelected);
    selectedLetterByQRef.current = nextSelected;

    setShowScannerPrompt(false);
    setShowingFeedback(true);
    setFeedbackMessage("Correct!");

    setFlashColor("green");

    setStreak((s) => {
      const next = s + 1;
      if (next >= 2) showStreakBanner(`${next} in a row 🔥`);
      return next;
    });

    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashColor(null), 300);

    try { window.__curriculatePlayCorrectSound?.(); } catch {}
    try { navigator.vibrate?.(60); } catch {}

    const delay = Number(task?.config?.feedbackDelay ?? 1200) || 1200;

    clearAdvanceTimer();
    advanceTimerRef.current = setTimeout(() => {
      const nextIndex = qIndex + 1;
      const done = nextIndex >= items.length;

      emitAnswerResult(true, true, done);

      if (!done) {
        setShowingFeedback(false);
        setFeedbackMessage("");
        resetGlobalScanDedupe();
        setQIndex(nextIndex);
        setShowScannerPrompt(true);
        return;
      }

      if (submittedOnceRef.current) return;
      submittedOnceRef.current = true;

      const answers = items.map((item, idx) => {
        const itemCorrect = resolveCorrectLetter(item.correctAnswer);

        const letter = nextSelected[idx] ?? null;
        return {
          letter,
          correct: item.correctAnswer,
          isCorrect: letter === itemCorrect,
        };
      });

      onSubmit?.({
        ok: true,
        type: "physical-multiple-choice",
        completed: true,
        answers,
        score: answers.filter((a) => a.isCorrect).length,
        total: items.length,
        lastScannedColor: lastValidScanColorRef.current || null,
      });
    }, delay);

    return true;
  };

  // Install scan handler for StudentApp short-circuit
  const installedHookRef = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hookFn = (v) => acceptColorScan(v);
    installedHookRef.current = hookFn;
    window.__curriculateTaskScanHandler = hookFn;

    return () => {
      if (window.__curriculateTaskScanHandler === installedHookRef.current) {
        window.__curriculateTaskScanHandler = null;
      }
      installedHookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, isReview, showScannerPrompt, showingFeedback, qIndex, currentMap]);

  const triggerFeedbackFx = (kind) => {
    // flash
    setFlashColor(kind);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashColor(null), 300);

    // sound
    try {
      if (kind === "green") {
        window.__curriculatePlayCorrectSound?.();
      } else {
        window.__curriculatePlayWrongSound?.();
      }
    } catch {}

    // vibration
    try {
      if (navigator?.vibrate) {
        if (kind === "green") navigator.vibrate(80);
        else if (kind === "red") navigator.vibrate([70, 40, 70]);
        else navigator.vibrate(40); // yellow / invalid
      }
    } catch {}
  };

  // Listen to StudentApp’s normalized station scan event (Option 1)
  useEffect(() => {
    const onStationScan = (ev) => {
      const d = ev?.detail || {};
      acceptColorScan(d?.color || d?.stationColor || d);
    };
    window.addEventListener("curriculate:stationScan", onStationScan);
    return () => window.removeEventListener("curriculate:stationScan", onStationScan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, isReview, showScannerPrompt, showingFeedback, qIndex, currentMap]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      clearAdvanceTimer();
      clearErrorTimer();
      clearStreakTimer();
    };
  }, []);

  // UI helpers
  function getColorCss(color) {
    const map = {
      Red: "#ef4444",
      Orange: "#f97316",
      Yellow: "#eab308",
      Green: "#22c55e",
      Blue: "#3b82f6",
      Teal: "#14b8a6",
      Purple: "#a855f7",
      Pink: "#ec4899",
    };
    return map[color] || "#6b7280";
  }

  const clearStreakTimer = () => {
    if (streakTimerRef.current) clearTimeout(streakTimerRef.current);
    streakTimerRef.current = null;
  };

  const showStreakBanner = (text) => {
    setStreakBanner(text);
    clearStreakTimer();
    streakTimerRef.current = setTimeout(() => {
      setStreakBanner("");
    }, 1200);
  };

  function getOptionStyle(chosen, isCorrect, isWrong, stationColor) {
    const base = {
      background: getColorCss(stationColor),
      color: "#ffffff",
      borderColor: "transparent",
      boxShadow: "none",
    };
    if (isCorrect) base.boxShadow = "0 0 0 4px rgba(34,197,94,0.5)";
    if (isWrong) base.boxShadow = "0 0 0 4px rgba(239,68,68,0.5)";
    if (chosen && !isCorrect && !isWrong) base.boxShadow = "0 8px 20px rgba(99,102,241,0.35)";
    return base;
  }

  const selectedLetter = selectedLetterByQ[qIndex] ?? null;
  const correctIndex = letters.indexOf(correctLetter);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-indigo-950 to-purple-950 text-white p-4 pb-20">
      {scanError && (
        <div
          style={{
            color: "#fff",
            background: "rgba(0,0,0,0.75)",
            padding: "10px 14px",
            borderRadius: 8,
            fontWeight: 600,
            textAlign: "center",
            marginTop: 10,
          }}
        >
          {scanError}
        </div>
      )}

      {/* “Use global scanner” overlay (NO QrScanner here) */}
      {streakBanner && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-orange-500/90 px-6 py-3 rounded-xl shadow-xl text-white font-bold">
          {streakBanner}
        </div>
      )}
      {wantsScan && (
        <div className="fixed inset-0 z-40 bg-black/75 flex flex-col items-center justify-center">
          <div className="relative w-[min(90vw,380px)] aspect-square rounded-3xl overflow-hidden border-4 border-cyan-400/60 shadow-2xl shadow-cyan-900/40">
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900 to-black" />
            <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
            </div>

            <div
              className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-300 to-transparent pointer-events-none"
              style={{
                animation: "scanVertical 3.2s cubic-bezier(0.4,0,0.6,1) infinite",
                boxShadow: "0 0 24px #22d3ee",
              }}
            />

            <div className="absolute inset-6 pointer-events-none">
              <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-cyan-300 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-cyan-300 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-cyan-300 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-cyan-300 rounded-br-xl" />
            </div>
          </div>

          <p className="mt-10 text-xl font-semibold text-center px-8 drop-shadow-lg">
            Scan the colored station that matches your answer
          </p>

          <style>{`
            @keyframes scanVertical {
              0%   { top: -20%; opacity: 0.5; }
              25%  { opacity: 1; }
              50%  { top: 120%; opacity: 0.5; }
              75%  { opacity: 1; }
              100% { top: -20%; opacity: 0.5; }
            }
          `}</style>
        </div>
      )}

      {showingFeedback && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div
            className={`text-5xl font-bold px-12 py-8 rounded-3xl shadow-2xl ${
              feedbackMessage.includes("Correct") ? "bg-green-600/90" : "bg-red-600/90"
            }`}
          >
            {feedbackMessage}
          </div>
        </div>
      )}

      {flashColor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              flashColor === "green"
                ? "rgba(0,255,0,0.25)"
                : flashColor === "red"
                ? "rgba(255,0,0,0.25)"
                : "rgba(255,200,0,0.25)",
            pointerEvents: "none",
            zIndex: 9999,
            transition: "opacity 0.2s ease",
          }}
        />
      )}

      <div className="max-w-3xl mx-auto pt-6">
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Question {qIndex + 1} of {items.length}
        </h2>

        <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-6 md:p-8 mb-8 border border-white/10">
          <p className="text-xl md:text-2xl font-medium leading-relaxed mb-10">
            {currentQuestion?.prompt || "—"}
          </p>

          <div className="grid gap-5">
            {letters.map((letter, idx) => {
              const text = options[idx] ?? `Option ${letter}`;
              const chosen = selectedLetter === letter;
              const wrongLetters = wrongLettersByQ[qIndex] || [];
              const showX = wrongLetters.includes(letter);
              const isCorrect = showingFeedback && idx === correctIndex;
              const isWrong = showingFeedback && chosen && idx !== correctIndex;
              const stationColor = currentMap[letter];
              const style = getOptionStyle(chosen, isCorrect, isWrong, stationColor);

              return (
                <div
                  key={letter}
                  className="rounded-2xl p-5 flex items-center justify-between transition-all duration-300"
                  style={style}
                >
                  <div className="flex items-center gap-5">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold text-white shrink-0"
                      style={{ background: "rgba(0,0,0,0.25)" }}
                    >
                      {letter}
                    </div>
                    <div className="text-lg md:text-xl font-semibold">{text}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {showX && (
                      <span className="text-2xl font-black text-red-200">✕</span>
                    )}
                    <div className="text-base font-medium opacity-90">
                      {stationColor}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-center text-slate-400 text-sm">
          Scan a station to submit • Only shown colors are accepted
        </div>
      </div>
    </div>
  );
}
