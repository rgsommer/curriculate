// src/components/tasks/types/PhysicalMultipleChoiceTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Physical Multiple Choice Task – SUPER PREMIUM GAMING EXPERIENCE
 * Showstopper quality with animations, sound, visual feedback, and celebration
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
 *
 * VISUAL DESIGN: Kahoot-style bold colors, smooth animations, arcade-grade feedback
 */

export default function PhysicalMultipleChoiceTask({
  task,
  onSubmit,
  disabled = false,
  mode = "play",
  excludedColor = null,
  excludedColors = null,
  onIncorrectScan = null,
  scannerSlot = null,  // ReactNode: actual <QrScanner> passed from parent
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

  // New gaming UX state
  const [score, setScore] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [shakedLetter, setShakedLetter] = useState(null);
  const [pulsingLetters, setPulsingLetters] = useState(new Set());
  const [animatingCards, setAnimatingCards] = useState(new Set());

  const normalizeColor = (c) =>
    typeof c === "string" ? c.trim().toLowerCase() : "";

  // Play sound effect with fallback
  const playSound = (soundUrl) => {
    try {
      const audio = new Audio(soundUrl);
      audio.volume = 0.8;
      audio.play().catch(() => {});
    } catch {}
  };

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
      setScore(0);
      setShowCelebration(false);
      setShakedLetter(null);
      setPulsingLetters(new Set());
      setAnimatingCards(new Set());

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
      setScanError("Oops! That's not one of the options. Try again!");
      clearErrorTimer();
      errorTimerRef.current = setTimeout(() => setScanError(""), 1800);

      setFlashColor("yellow");
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashColor(null), 400);

      // Play buzzer sound
      playSound("/sounds/buzz.mp3");
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

      // Trigger shake animation
      setShakedLetter(matchingLetter);

      setShowScannerPrompt(false);
      setShowingFeedback(true);
      setFeedbackMessage("Not quite! Try again!");

      setFlashColor("red");
      setStreak(0);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashColor(null), 500);

      // Play buzzer sound
      playSound("/sounds/buzz.mp3");
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
        setShakedLetter(null);
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

    // Trigger pulsing animation on correct answer
    setPulsingLetters((prev) => new Set([...prev, matchingLetter]));

    setShowScannerPrompt(false);
    setShowingFeedback(true);
    setFeedbackMessage("🎉 Correct!");

    setFlashColor("green");

    setStreak((s) => {
      const next = s + 1;
      if (next >= 2) showStreakBanner(`${next} in a row 🔥`);
      return next;
    });

    // Update score
    setScore((prev) => prev + 1);

    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashColor(null), 500);

    // Play success sound
    playSound("/sounds/yay.mp3");
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
        setPulsingLetters(new Set());
        resetGlobalScanDedupe();
        setQIndex(nextIndex);
        setShowScannerPrompt(true);
        return;
      }

      if (submittedOnceRef.current) return;
      submittedOnceRef.current = true;

      // Show celebration!
      setShowCelebration(true);

      const answers = items.map((item, idx) => {
        const itemCorrect = resolveCorrectLetter(item.correctAnswer);

        const letter = nextSelected[idx] ?? null;
        return {
          letter,
          correct: item.correctAnswer,
          isCorrect: letter === itemCorrect,
        };
      });

      setTimeout(() => {
        onSubmit?.({
          ok: true,
          type: "physical-multiple-choice",
          completed: true,
          answers,
          score: answers.filter((a) => a.isCorrect).length,
          total: items.length,
          lastScannedColor: lastValidScanColorRef.current || null,
        });
      }, 2000);
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

  // Listen to StudentApp's normalized station scan event (Option 1)
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

  // UI helpers - bold Kahoot-style colors
  function getColorCss(color) {
    const map = {
      Red: "#ee3333",
      Orange: "#ff6633",
      Yellow: "#ffdd33",
      Green: "#33dd33",
      Blue: "#3366ff",
      Teal: "#00cccc",
      Purple: "#dd33ff",
      Pink: "#ff3399",
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

  const selectedLetter = selectedLetterByQ[qIndex] ?? null;
  const correctIndex = letters.indexOf(correctLetter);

  // Confetti particles for celebration
  const confetti = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    delay: i * 40,
    duration: 2000 + Math.random() * 1000,
  }));

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f0f2e 0%, #1a0f3e 50%, #2d0f4e 100%)",
        color: "#ffffff",
        padding: "16px",
        paddingBottom: "80px",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`
        @keyframes pmcScanLine {
          0%   { top: 0%; opacity: 0.5; }
          50%  { top: 100%; opacity: 1; }
          100% { top: 0%; opacity: 0.5; }
        }
        @keyframes pmcCardPop {
          0% { transform: scale(0.8) rotateX(90deg); opacity: 0; }
          70% { transform: scale(1.08); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pmcPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); box-shadow: 0 0 30px currentColor; }
        }
        @keyframes pmcBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes pmcShake {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          25% { transform: translateX(-8px) rotate(-2deg); }
          75% { transform: translateX(8px) rotate(2deg); }
        }
        @keyframes pmcConfetti {
          0% { transform: translateY(0) rotateZ(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotateZ(720deg); opacity: 0; }
        }
        .pmc-card-pop { animation: pmcCardPop 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards; }
        .pmc-pulse { animation: pmcPulse 0.8s ease-in-out infinite; }
        .pmc-bounce { animation: pmcBounce 0.6s ease-out; }
        .pmc-shake { animation: pmcShake 0.4s ease-in-out; }
      `}</style>

      {/* Celebration confetti */}
      {showCelebration && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, pointerEvents: "none" }}>
          {confetti.map((c) => (
            <div
              key={c.id}
              style={{
                position: "absolute",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: getColorCss(
                  ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Teal"][c.id % 8]
                ),
                left: `${Math.random() * 100}%`,
                top: "-20px",
                animation: `pmcConfetti ${c.duration}ms ease-in forwards`,
                animationDelay: `${c.delay}ms`,
              }}
            />
          ))}
        </div>
      )}

      {/* Error message banner */}
      {scanError && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            color: "#fff",
            background: "rgba(239, 68, 68, 0.95)",
            padding: "14px 20px",
            borderRadius: "12px",
            fontWeight: 700,
            textAlign: "center",
            fontSize: "1rem",
            boxShadow: "0 10px 30px rgba(239, 68, 68, 0.3)",
            animation: "pmcShake 0.4s ease-in-out",
            maxWidth: "90%",
          }}
        >
          {scanError}
        </div>
      )}

      {/* Streak banner with fire */}
      {streakBanner && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "linear-gradient(135deg, #ff6633, #ffaa33)",
            color: "#fff",
            padding: "16px 24px",
            borderRadius: "16px",
            fontWeight: 800,
            fontSize: "1.3rem",
            boxShadow: "0 12px 40px rgba(255, 102, 51, 0.4)",
            animation: "pmcBounce 0.6s ease-out",
          }}
        >
          {streakBanner}
        </div>
      )}

      {/* Scanner prompt with camera frame */}
      {wantsScan && (
        <div
          style={{
            marginTop: "20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "min(90vw, 360px)",
              borderRadius: "24px",
              overflow: "hidden",
              border: "4px solid rgba(51, 187, 255, 0.8)",
              boxShadow: "0 0 40px rgba(51, 187, 255, 0.4), 0 12px 40px rgba(0, 0, 0, 0.6)",
              background: "#0f172a",
            }}
          >
            <div style={{ position: "relative" }}>
              {scannerSlot || (
                <div
                  style={{
                    height: "200px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(51, 187, 255, 0.8)",
                    fontSize: "3.5rem",
                    fontWeight: "bold",
                  }}
                >
                  📷
                </div>
              )}
            </div>

            {/* Animated scan line */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: "3px",
                background: "linear-gradient(to right, transparent, #33bbff, transparent)",
                boxShadow: "0 0 32px #33bbff",
                animation: "pmcScanLine 2.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                pointerEvents: "none",
              }}
            />

            {/* Corner brackets */}
            <div style={{ position: "absolute", inset: "12px", pointerEvents: "none" }}>
              {[
                { top: 0, left: 0, borderTop: "4px solid #33bbff", borderLeft: "4px solid #33bbff" },
                { top: 0, right: 0, borderTop: "4px solid #33bbff", borderRight: "4px solid #33bbff" },
                { bottom: 0, left: 0, borderBottom: "4px solid #33bbff", borderLeft: "4px solid #33bbff" },
                { bottom: 0, right: 0, borderBottom: "4px solid #33bbff", borderRight: "4px solid #33bbff" },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    width: "40px",
                    height: "40px",
                    borderRadius: i % 2 === 0 ? "12px 0 0 0" : "0 12px 0 0",
                    ...s,
                  }}
                />
              ))}
            </div>
          </div>

          <p
            style={{
              margin: 0,
              fontSize: "1.05rem",
              fontWeight: 700,
              textAlign: "center",
              opacity: 0.95,
              color: "#fff",
            }}
          >
            Scan the colored station matching your answer
          </p>
        </div>
      )}

      {/* Feedback overlay */}
      {showingFeedback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: feedbackMessage.includes("Correct") ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              fontSize: "4rem",
              fontWeight: 900,
              padding: "32px 48px",
              borderRadius: "32px",
              textAlign: "center",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.8)",
              background: feedbackMessage.includes("Correct")
                ? "linear-gradient(135deg, #33dd33, #00ff88)"
                : "linear-gradient(135deg, #ff3333, #ff6666)",
              color: "#fff",
              textShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
              animation: "pmcBounce 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)",
            }}
          >
            {feedbackMessage}
          </div>
        </div>
      )}

      {/* Flash overlay */}
      {flashColor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              flashColor === "green"
                ? "rgba(51, 221, 51, 0.35)"
                : flashColor === "red"
                ? "rgba(255, 51, 51, 0.35)"
                : "rgba(255, 200, 51, 0.25)",
            pointerEvents: "none",
            zIndex: 9999,
            animation: "fadeOut 0.5s ease-out forwards",
          }}
        />
      )}

      {/* Celebration screen */}
      {showCelebration && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9997,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "24px",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              fontSize: "5rem",
              fontWeight: 900,
              animation: "pmcBounce 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)",
            }}
          >
            🎉 Quiz Complete! 🎉
          </div>
          <div
            style={{
              fontSize: "2.5rem",
              fontWeight: 800,
              color: "#ffdd33",
              animation: "pmcPulse 1s ease-in-out infinite",
            }}
          >
            Score: {score}/{items.length}
          </div>
          <div
            style={{
              fontSize: "4rem",
              animation: "pmcBounce 1s cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.2s",
            }}
          >
            ⭐
          </div>
        </div>
      )}

      {/* Main content area */}
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          paddingTop: "24px",
        }}
      >
        {/* Header with question counter and score */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            paddingBottom: "16px",
            borderBottom: "2px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <h2
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              margin: 0,
              letterSpacing: "0.5px",
            }}
          >
            Question {qIndex + 1} of {items.length}
          </h2>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: 700,
              background: "rgba(51, 187, 255, 0.2)",
              padding: "8px 16px",
              borderRadius: "12px",
              border: "2px solid rgba(51, 187, 255, 0.5)",
            }}
          >
            Score: {score}
          </div>
        </div>

        {/* Question card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(20px)",
            borderRadius: "20px",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            padding: "32px 28px",
            marginBottom: "32px",
            boxShadow: "0 8px 40px rgba(0, 0, 0, 0.3)",
            animation: qIndex > 0 ? "pmcCardPop 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)" : "none",
          }}
        >
          <p
            style={{
              fontSize: "1.4rem",
              fontWeight: 600,
              margin: 0,
              lineHeight: 1.6,
              color: "#fff",
            }}
          >
            {currentQuestion?.prompt || "—"}
          </p>
        </div>

        {/* Answer grid - 2x2 layout */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {letters.map((letter, idx) => {
            const text = options[idx] ?? `Option ${letter}`;
            const chosen = selectedLetter === letter;
            const wrongLetters = wrongLettersByQ[qIndex] || [];
            const showX = wrongLetters.includes(letter);
            const isCorrect = showingFeedback && idx === correctIndex;
            const isWrong = showingFeedback && chosen && idx !== correctIndex;
            const stationColor = currentMap[letter];
            const baseColor = getColorCss(stationColor);
            const isShaken = shakedLetter === letter;

            return (
              <div
                key={letter}
                style={{
                  position: "relative",
                  borderRadius: "16px",
                  overflow: "hidden",
                  animation:
                    isShaken && showingFeedback && !isCorrect
                      ? "pmcShake 0.4s ease-in-out"
                      : pulsingLetters.has(letter) && isCorrect
                      ? "pmcPulse 0.8s ease-in-out"
                      : `pmcCardPop 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) ${idx * 100}ms backwards`,
                }}
              >
                <div
                  style={{
                    background: isCorrect
                      ? "linear-gradient(135deg, #33dd33, #00ff88)"
                      : isWrong
                      ? "linear-gradient(135deg, #ff3333, #ff6666)"
                      : baseColor,
                    color: "#ffffff",
                    padding: "24px 16px",
                    borderRadius: "16px",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: "1.05rem",
                    cursor: "pointer",
                    userSelect: "none",
                    boxShadow: isCorrect
                      ? "0 0 40px rgba(51, 221, 51, 0.6), inset 0 0 20px rgba(255, 255, 255, 0.2)"
                      : isWrong
                      ? "0 0 40px rgba(255, 51, 51, 0.6), inset 0 0 20px rgba(255, 255, 255, 0.1)"
                      : chosen
                      ? `0 0 30px ${baseColor}, inset 0 0 10px rgba(255, 255, 255, 0.15)`
                      : "0 4px 20px rgba(0, 0, 0, 0.3)",
                    transition: "all 0.3s cubic-bezier(0.2, 0.6, 0.2, 1)",
                    border: isCorrect || isWrong ? "2px solid rgba(255, 255, 255, 0.4)" : "2px solid transparent",
                    minHeight: "100px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: 900,
                      letterSpacing: "2px",
                    }}
                  >
                    {letter}
                  </div>
                  <div
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      lineHeight: 1.3,
                      opacity: 0.95,
                    }}
                  >
                    {text}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      opacity: 0.85,
                      marginTop: "4px",
                      fontWeight: 500,
                    }}
                  >
                    {stationColor}
                  </div>

                  {/* Wrong X indicator */}
                  {showX && (
                    <div
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        fontSize: "1.8rem",
                        fontWeight: 900,
                        color: "rgba(255, 255, 255, 0.9)",
                      }}
                    >
                      ✕
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Instruction text */}
        <div
          style={{
            textAlign: "center",
            fontSize: "0.95rem",
            fontWeight: 600,
            color: "rgba(255, 255, 255, 0.75)",
            marginTop: "20px",
          }}
        >
          📸 Scan a colored station to submit • Only shown colors accepted
        </div>
      </div>
    </div>
  );
}
