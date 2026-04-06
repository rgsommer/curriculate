// student-app/src/components/tasks/types/DrawMimeTask.jsx
import React, { useRef, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TaskCardFrame } from "../taskStyles";

export default function DrawMimeTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  presenter,
  memberNames,
  stagingPhase,
  canStartTask,
  startGoSequence,
  emitTaskEvent,
  playSfx,
}) {
  // ------------------------------
  // Small local helpers (safe fallback when TaskRunner doesn't inject BodyBreak helpers)
  // ------------------------------
  const beepRef = useRef(null);
  const playBeep = (freq = 880, ms = 110, volume = 0.06) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = beepRef.current || new AudioCtx();
      beepRef.current = ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.value = volume;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        try {
          o.stop();
          o.disconnect();
          g.disconnect();
        } catch {
          // no-op
        }
      }, ms);
    } catch {
      // no-op
    }
  };

  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState(8);
  const [tool, setTool] = useState("pen"); // "pen" | "eraser"
  const [awaitingOutcome, setAwaitingOutcome] = useState(false);

  // Simple round timer (used for Draw OR Mime).
  // Keeps demo/gameplay clear without changing the drawing engine.
  const durationSeconds =
    (typeof task?.config?.durationSeconds === "number" && task.config.durationSeconds) ||
    (typeof task?.durationSeconds === "number" && task.durationSeconds) ||
    60;
  const [started, setStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [mode, setMode] = useState("draw"); // "draw" | "mime"

  // ── Clues for each round (1–4) ──
  const clues = useMemo(() => {
    const arr = Array.isArray(task?.clues) && task.clues.length > 0
      ? task.clues.map((c) => String(c || "").trim()).filter(Boolean)
      : null;
    const single = String(task?.prompt || "").trim() || "Draw or Mime";
    return arr || [single];
  }, [task]);

  const [roundIndex, setRoundIndex] = useState(0);
  const totalRounds = clues.length;           // 1–4
  const currentClue = clues[Math.min(roundIndex, clues.length - 1)];
  const isLastRound = roundIndex >= totalRounds - 1;

  // ── Wizard phase state ──
  // mode → howtoplay → pass → clue → active → timeout → reveal → rate → done
  const [phase, setPhase] = useState("mode");
  const [clueRevealed, setClueRevealed] = useState(false);
  const [pendingResult, setPendingResult] = useState(null);
  const [ratings, setRatings] = useState({}); // { emoji: count }

  // BodyBreak-like countdown overlay (fallback). TaskRunner can replace this via startGoSequence.
  const [countdown, setCountdown] = useState(null); // 3..2..1.."GO"
  const [roundActive, setRoundActive] = useState(false); // "official" round started

  // Mirror BodyBreak: hide/disable Start until TaskRunner staging/intro is fully gone.
  const canStart = Boolean(canStartTask) || stagingPhase === "gone" || stagingPhase == null;

  // Turnkeeper + scoring
  // Players come from generator. If not provided, we default to 4 (2 vs 2).
  const players = useMemo(() => {
    const fromConfig =
      (Array.isArray(task?.config?.players) && task.config.players) ||
      (Array.isArray(task?.players) && task.players) ||
      [];

    const fromMembers = Array.isArray(memberNames)
      ? memberNames
          .map((name, idx) => ({
            id: `m${idx + 1}`,
            name: String(name || "").trim(),
          }))
          .filter((p) => p.name)
      : [];

    const base =
      fromConfig.length > 0
        ? fromConfig.map((p, idx) => ({
            id: p?.id || `p${idx + 1}`,
            name: String(p?.name || `Player ${idx + 1}`),
          }))
        : fromMembers;

    const count =
      (Number.isInteger(task?.config?.playerCount) && task.config.playerCount) ||
      (Number.isInteger(task?.playerCount) && task.playerCount) ||
      (base.length || 4);

    const normalized = base.slice(0, count);

    while (normalized.length < count) {
      normalized.push({
        id: `p${normalized.length + 1}`,
        name: `Player ${normalized.length + 1}`,
      });
    }

    return normalized;
  }, [task, memberNames]);

  const playerCount = players.length;

  const sideForIndex = (idx) => {
    // 4 players: 0,1 = Left team; 2,3 = Right team
    if (playerCount === 4) return idx <= 1 ? "left" : "right";
    // otherwise odd/even
    return idx % 2 === 0 ? "left" : "right";
  };

  const gradeLevel =
    (Number.isInteger(task?.config?.gradeLevel) && task.config.gradeLevel) ||
    (Number.isInteger(task?.gradeLevel) && task.gradeLevel) ||
    (Number.isInteger(task?.config?.grade) && task.config.grade) ||
    (Number.isInteger(task?.grade) && task.grade) ||
    null;

  // Generator SHOULD set: task.config.turnStyle = "inter" | "intra".
  // Fallback rule (as requested): if grade > 5, randomly choose inter/intra.
  const turnStyle = useMemo(() => {
    const fromConfig = String(task?.config?.turnStyle || task?.turnStyle || "").toLowerCase();
    if (fromConfig === "inter" || fromConfig === "intra") return fromConfig;
    if (typeof gradeLevel === "number" && gradeLevel > 5) {
      // pseudo-random but stable per task (no flicker)
      const seed = String(task?.id || task?._id || task?.prompt || "drawmime");
      let h = 0;
      for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return h % 2 === 0 ? "inter" : "intra";
    }
    return "inter";
  }, [task, gradeLevel]);

  const [performerIdx, setPerformerIdx] = useState(0);
  const [scoreLeft, setScoreLeft] = useState(0);
  const [scoreRight, setScoreRight] = useState(0);
  const [lastWinner, setLastWinner] = useState(null); // { name, side, bonus }

  // UI pulse when turn changes
  const [turnPulse, setTurnPulse] = useState(false);
  const prevPerformerRef = useRef(performerIdx);

  const performer = players[Math.max(0, Math.min(players.length - 1, performerIdx))];
  const performerSide = sideForIndex(performerIdx);
  const guessingSide = turnStyle === "intra" ? performerSide : performerSide === "left" ? "right" : "left";

  const guessers = useMemo(() => {
    return players
      .map((p, idx) => ({ ...p, idx, side: sideForIndex(idx) }))
      .filter((p) => p.idx !== performerIdx)
      .filter((p) => p.side === guessingSide);
  }, [players, performerIdx, guessingSide, playerCount]);

  // Pulse + "your turn" sound when performer changes.
  useEffect(() => {
    if (prevPerformerRef.current === performerIdx) return;
    prevPerformerRef.current = performerIdx;
    setTurnPulse(true);
    const t = setTimeout(() => setTurnPulse(false), 260);
    // Prefer TaskRunner sfx (mirrors BodyBreak), fallback to a soft beep.
    if (typeof playSfx === "function") playSfx("yourTurn");
    else playBeep(660, 90, 0.05);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performerIdx]);

  const bumpScore = (side, delta) => {
    if (side === "left") setScoreLeft((n) => (Number(n) || 0) + (Number(delta) || 0));
    if (side === "right") setScoreRight((n) => (Number(n) || 0) + (Number(delta) || 0));
  };

  const nextPerformer = () => {
    setPerformerIdx((idx) => {
      const cur = Number(idx) || 0;
      return (cur + 1) % Math.max(1, players.length);
    });
  };

  const endRound = ({ guessedBy, guessedBySide, reason }) => {
    // Stop the round.
    setRoundActive(false);
    setStarted(false);
    setCountdown(null);

    const secondsUsed = durationSeconds - timeLeft;
    const guessed = !!guessedBy;
    const bonus = guessed ? Math.max(0, Math.min(3, Math.floor(timeLeft / 15))) : 0; // 0..3

    if (guessed) {
      // Bonus point to performer + guesser team for guessing before time.
      bumpScore(performerSide, 1 + bonus);
      bumpScore(guessedBySide, 1 + bonus);
      setLastWinner({ name: guessedBy, side: guessedBySide, bonus });
    } else {
      setLastWinner({ name: null, side: null, bonus: 0, reason: reason || "time" });
    }

    // Mirror BodyBreak: emit start/end events when available.
    if (typeof emitTaskEvent === "function") {
      emitTaskEvent("task:ended", {
        taskType: "draw-mime",
        mode,
        turnStyle,
        performer: performer?.name,
        performerSide,
        guessedBy,
        guessedBySide,
        secondsUsed,
        bonus,
        reason: reason || (guessed ? "guessed" : "time"),
      });
    }

    // Store result — actual onSubmit fires from the "done" phase Finish button.
    const payload = {
      type: mode === "mime" ? "mime" : "drawing",
      mode,
      turnStyle,
      performer: performer?.name,
      performerSide,
      guessedBy: guessedBy || null,
      guessedBySide: guessedBySide || null,
      bonus,
      secondsUsed,
      completed: true,
    };

    setPendingResult(payload);
    setPhase("reveal");
  };

  // Called from the "done" phase.
  // If more rounds remain → advance to next round without submitting.
  // On the final round → submit the task result.
  const finishRound = () => {
    const payload = pendingResult || { type: mode, completed: true };

    if (isLastRound) {
      // All rounds done — submit once
      onSubmit?.({ ...payload, roundIndex, totalRounds, allRoundsDone: true });
      // Reset round counter for if the task somehow restarts
      setRoundIndex(0);
      setPerformerIdx(0);
    } else {
      // Advance to the next clue / performer without submitting
      setRoundIndex((r) => r + 1);
      nextPerformer();
    }

    setPhase("mode");
    setPendingResult(null);
    setRatings({});
    setClueRevealed(false);
  };

  const startRound = async () => {
    if (disabled) return;
    if (roundActive) return;

    // Reset the round state.
    setAwaitingOutcome(false);
    setHasDrawn(false);
    setStarted(false);
    setCountdown(null);
    setLastWinner(null);
    setTimeLeft(durationSeconds);
    // Reset history so undo/redo starts clean each round.
    historyRef.current = [];
    historyStepRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    onAnswerChange?.(null);
    // Clear canvas for a fresh round (don't depend on clearCanvas ordering).
    try {
      const ctx = canvasRef.current?.getContext?.("2d");
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    } catch {
      // no-op
    }

    // Preferred (BodyBreak-style): delegate countdown + GO cue to TaskRunner.
    if (typeof startGoSequence === "function") {
      if (typeof emitTaskEvent === "function") {
        emitTaskEvent("task:starting", {
          taskType: "draw-mime",
          mode,
          turnStyle,
          performer: performer?.name,
          performerSide,
          guessingSide,
          durationSeconds,
        });
      }
      await startGoSequence({ seconds: 3, label: "1‑2‑3 GO!" });
      if (typeof emitTaskEvent === "function") {
        emitTaskEvent("task:started", {
          taskType: "draw-mime",
          mode,
          turnStyle,
          performer: performer?.name,
          performerSide,
          guessingSide,
          durationSeconds,
        });
      }
      setRoundActive(true);
      setStarted(true);
      return;
    }

    // Fallback: local 3-2-1-GO overlay + soft beep.
    setCountdown(3);
    playBeep(520, 90, 0.05);
    await new Promise((r) => setTimeout(r, 700));
    setCountdown(2);
    playBeep(520, 90, 0.05);
    await new Promise((r) => setTimeout(r, 700));
    setCountdown(1);
    playBeep(520, 90, 0.05);
    await new Promise((r) => setTimeout(r, 700));
    setCountdown("GO");
    playBeep(880, 120, 0.07);
    await new Promise((r) => setTimeout(r, 450));
    setCountdown(null);
    setRoundActive(true);
    setStarted(true);
  };

  const markGuessed = (guesser) => {
    if (!roundActive) return;
    if (!guesser?.name) return;
    endRound({ guessedBy: guesser.name, guessedBySide: guesser.side, reason: "guessed" });
  };

  // Undo/Redo
  const historyRef = useRef([]);
  const historyStepRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Load saved drawing
  useEffect(() => {
    if (answerDraft?.imageData) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.drawImage(img, 0, 0);
        pushToHistory();
        setHasDrawn(true);
      };
      img.src = answerDraft.imageData;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerDraft]);

  // Canvas setup + resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = Math.max(240, rect.height - 200);
      redrawFromHistory();
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset timer when the task changes (new concept / new round)
  useEffect(() => {
    setStarted(false);
    setTimeLeft(durationSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?._id, durationSeconds]);

  // Countdown
  useEffect(() => {
    if (!started || disabled) return;
    if (timeLeft <= 0) return;
    const t = setInterval(() => setTimeLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [started, timeLeft, disabled]);

  // Auto-end the round when time hits 0 (BodyBreak-style).
  useEffect(() => {
    if (!roundActive) return;
    if (disabled) return;
    if (timeLeft !== 0) return;
    setRoundActive(false);
    setStarted(false);
    setCountdown(null);
    setPhase("timeout");
  }, [timeLeft, roundActive, disabled]);

  const pushToHistory = () => {
    const dataUrl = canvasRef.current.toDataURL();
    historyRef.current = historyRef.current.slice(0, historyStepRef.current + 1);
    historyRef.current.push(dataUrl);
    historyStepRef.current += 1;
    if (historyRef.current.length > 30) {
      historyRef.current.shift();
      historyStepRef.current -= 1;
    }
    setCanUndo(historyStepRef.current > 0);
    setCanRedo(false);
    onAnswerChange?.({ imageData: dataUrl, completed: true });
  };

  const redrawFromHistory = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (historyStepRef.current < 0) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = historyRef.current[historyStepRef.current];
  };

  const undo = () => {
    if (historyStepRef.current <= 0) return;
    historyStepRef.current -= 1;
    redrawFromHistory();
    setCanUndo(historyStepRef.current > 0);
    setCanRedo(true);
    setHasDrawn(historyStepRef.current > 0);
  };

  const redo = () => {
    if (historyStepRef.current >= historyRef.current.length - 1) return;
    historyStepRef.current += 1;
    redrawFromHistory();
    setCanRedo(historyStepRef.current < historyRef.current.length - 1);
    setCanUndo(true);
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    historyRef.current = [];
    historyStepRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setHasDrawn(false);
    onAnswerChange?.(null);
  };

  // Pressure-aware drawing
  const startDrawing = (e) => {
    if (disabled) return;
    if (mode === "mime") return;
    setIsDrawing(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();

    const getPointerInfo = (e) => {
      const pointer = e.nativeEvent;
      return {
        x: pointer.clientX - rect.left,
        y: pointer.clientY - rect.top,
        pressure: pointer.pressure || 0.5, // 0.0 to 1.0 (fallback 0.5)
        isTouch: e.type.includes("touch"),
      };
    };

    const { x, y, pressure } = getPointerInfo(e);

    // Set tool
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }

    // Base line width + pressure multiplier
    const baseWidth = lineWidth;
    const maxWidth = baseWidth * 3; // Pressure can triple thickness
    ctx.lineWidth = baseWidth + pressure * (maxWidth - baseWidth);

    ctx.beginPath();
    ctx.moveTo(x, y);

    const draw = (e) => {
      const { x: mx, y: my, pressure: p } = getPointerInfo(e);
      const currentWidth = baseWidth + p * (maxWidth - baseWidth);
      ctx.lineWidth = currentWidth;
      ctx.lineTo(mx, my);
      ctx.stroke();
    };

    const stop = () => {
      canvas.removeEventListener("pointermove", draw);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("pointerleave", stop);

      pushToHistory();
      setHasDrawn(true);
      setIsDrawing(false);
    };

    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
  };

  const handleSubmit = () => {
    if (disabled) return;
    if (!roundActive) return;
    if (mode !== "mime" && !hasDrawn) return;
    endRound({ guessedBy: null, guessedBySide: null, reason: "manual" });
  };

  const prompt = currentClue;

  // Performer taps GO — start timer and move to active phase.
  const handleGo = async () => {
    await startRound();
    setPhase("active");
  };

  // Shared phase animation variants.
  const pv = {
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
    exit:    { opacity: 0, y: -16, transition: { duration: 0.18 } },
  };

  // Top rating emoji for the "done" screen.
  const topRatingEmoji = Object.entries(ratings).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Timer color shifts as time runs low.
  const timerColor = timeLeft > 20 ? "#4ade80" : timeLeft > 10 ? "#facc15" : "#f87171";

  // Shared button styles
  const bigBtn = (bg = "#22c55e", color = "#000") => ({
    padding: "20px 40px", borderRadius: 24, fontSize: "1.6rem", fontWeight: 900,
    background: bg, color, border: "none", cursor: "pointer",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)", transition: "transform 0.12s",
  });
  const smBtn = (bg = "rgba(255,255,255,0.15)", color = "#fff") => ({
    padding: "12px 22px", borderRadius: 16, fontSize: "1.1rem", fontWeight: 700,
    background: bg, color, border: "none", cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)", transition: "transform 0.1s",
  });

  return (
    <TaskCardFrame theme="dark" fullBleed showBackground={false}>
      <div style={{
        display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
        background: "linear-gradient(135deg, #7c3aed 0%, #db2777 50%, #ea580c 100%)",
        color: "#fff",
      }}>
        <AnimatePresence mode="wait">

          {/* ── MODE SELECTION ── */}
          {phase === "mode" && (
            <motion.div key="mode" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 32, textAlign: "center" }}>
              {totalRounds > 1 && (
                <div style={{ fontSize: "0.85rem", fontWeight: 700, opacity: 0.65, letterSpacing: 1, textTransform: "uppercase" }}>
                  Round {roundIndex + 1} of {totalRounds}
                </div>
              )}
              <div style={{ fontSize: "3rem", fontWeight: 900, textShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
                DRAW OR MIME IT!
              </div>
              <div style={{ fontSize: "1.3rem", opacity: 0.85 }}>
                {performer?.name ? `${performer.name}, choose your mode:` : "Choose your mode for this round:"}
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
                <motion.button whileTap={{ scale: 0.94 }} style={{ ...bigBtn("#3b82f6", "#fff"), minWidth: 160, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
                  onClick={() => { setMode("draw"); setPhase("howtoplay"); }}>
                  <span style={{ fontSize: "3rem" }}>🎨</span>
                  Drawing
                </motion.button>
                <motion.button whileTap={{ scale: 0.94 }} style={{ ...bigBtn("#a855f7", "#fff"), minWidth: 160, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
                  onClick={() => { setMode("mime"); setPhase("howtoplay"); }}>
                  <span style={{ fontSize: "3rem" }}>🤫</span>
                  Miming
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── HOW TO PLAY ── */}
          {phase === "howtoplay" && (
            <motion.div key="howtoplay" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 24, textAlign: "center" }}>
              <div style={{ fontSize: "4rem" }}>{mode === "draw" ? "🎨" : "🤫"}</div>
              <div style={{ fontSize: "2.2rem", fontWeight: 900 }}>{mode === "draw" ? "Drawing Mode" : "Mime Mode"}</div>
              <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 20, padding: "20px 28px", maxWidth: 380, width: "100%", textAlign: "left", fontSize: "1.2rem", lineHeight: 1.7 }}>
                {mode === "draw" ? (
                  <>
                    <div>✏️ Grab <strong>paper + a pen</strong> — draw your clue on paper</div>
                    <div style={{ marginTop: 10 }}>🚫 No letters, numbers, or words</div>
                    <div style={{ marginTop: 10 }}>👆 Your team taps <strong>Guessed it!</strong> when they know</div>
                  </>
                ) : (
                  <>
                    <div>🤫 Act it out — <strong>no talking, no sounds</strong></div>
                    <div style={{ marginTop: 10 }}>📱 Put the device down before you start</div>
                    <div style={{ marginTop: 10 }}>👆 Your team taps <strong>Guessed it!</strong> when they know</div>
                  </>
                )}
              </div>
              <motion.button whileTap={{ scale: 0.95 }} style={bigBtn("#22c55e")}
                onClick={() => setPhase("pass")}>
                Got it! →
              </motion.button>
              <button style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: "0.9rem", cursor: "pointer" }}
                onClick={() => setPhase("mode")}>← Back</button>
            </motion.div>
          )}

          {/* ── PASS TO PERFORMER ── */}
          {phase === "pass" && (
            <motion.div key="pass" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "2rem", opacity: 0.85 }}>📱 Hand the phone to:</div>
              <div style={{ fontSize: "3.5rem", fontWeight: 900, textShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
                {performer?.name || "the performer"}
              </div>
              {mode === "draw" && (
                <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 16, padding: "14px 24px", fontSize: "1.2rem", fontWeight: 700 }}>
                  ✏️ Grab some paper and a pen first!
                </div>
              )}
              <div style={{ opacity: 0.7, fontSize: "0.95rem", marginTop: 8 }}>
                {performer?.name}, tap below once you have the device.
              </div>
              <motion.button whileTap={{ scale: 0.95 }} style={bigBtn("#f59e0b", "#000")}
                onClick={() => { setClueRevealed(false); setPhase("clue"); }}>
                I have it — I'm ready! →
              </motion.button>
            </motion.div>
          )}

          {/* ── CLUE REVEAL (performer's view) ── */}
          {phase === "clue" && (
            <motion.div key="clue" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 24, textAlign: "center" }}>
              <div style={{ fontSize: "1.4rem", opacity: 0.8 }}>Hi {performer?.name || "performer"}! 👋</div>
              {!clueRevealed ? (
                <>
                  <div style={{ fontSize: "1.1rem", opacity: 0.65 }}>Make sure your team isn't peeking...</div>
                  <motion.button whileTap={{ scale: 0.95 }} style={{ ...bigBtn("#fff", "#000"), fontSize: "1.8rem" }}
                    onClick={() => setClueRevealed(true)}>
                    👁️ Reveal my clue
                  </motion.button>
                </>
              ) : (
                <>
                  <div style={{ opacity: 0.7, fontSize: "1rem" }}>Your clue:</div>
                  <div style={{ fontSize: "2.8rem", fontWeight: 900, background: "rgba(0,0,0,0.3)", borderRadius: 20, padding: "20px 32px", maxWidth: 480, lineHeight: 1.3 }}>
                    {prompt}
                  </div>
                  {mode === "draw" && (
                    <div style={{ opacity: 0.75, fontSize: "0.95rem" }}>✏️ Draw it on paper — no words or letters!</div>
                  )}
                  <motion.button whileTap={{ scale: 0.95 }} style={{ ...bigBtn("#22c55e"), fontSize: "2rem", marginTop: 8 }}
                    onClick={handleGo}>
                    1-2-3 GO! 🚀
                  </motion.button>
                </>
              )}
            </motion.div>
          )}

          {/* ── ACTIVE ROUND ── */}
          {phase === "active" && (
            <motion.div key="active" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "1.2rem", opacity: 0.75 }}>{mode === "draw" ? "🎨 Drawing..." : "🤫 Miming..."}</div>
              <div style={{ fontSize: "5rem", fontWeight: 900, color: timerColor, textShadow: "0 4px 20px rgba(0,0,0,0.3)", transition: "color 0.5s" }}>
                ⏱️ {timeLeft}s
              </div>
              <motion.button whileTap={{ scale: 0.95 }}
                style={{ ...bigBtn("#4ade80", "#000"), fontSize: "2rem", padding: "24px 48px", boxShadow: "0 12px 32px rgba(0,0,0,0.3)" }}
                onClick={() => endRound({ guessedBy: `${guessingSide === "left" ? "Left" : "Right"} Team`, guessedBySide: guessingSide, reason: "guessed" })}>
                ✅ Guessed it!
              </motion.button>
              {guessers.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ opacity: 0.6, fontSize: "0.9rem", marginBottom: 8 }}>or tap who guessed it:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                    {guessers.map(g => (
                      <button key={g.id} style={smBtn()} onClick={() => endRound({ guessedBy: g.name, guessedBySide: g.side, reason: "guessed" })}>
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ── TIMEOUT ── */}
          {phase === "timeout" && (
            <motion.div key="timeout" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "4rem" }}>⏰</div>
              <div style={{ fontSize: "2.5rem", fontWeight: 900 }}>Time's Up!</div>
              <div style={{ fontSize: "1.2rem", opacity: 0.8 }}>Did anyone sneak in a guess?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center" }}>
                {guessers.map(g => (
                  <motion.button whileTap={{ scale: 0.95 }} key={g.id} style={bigBtn("#22c55e", "#000")}
                    onClick={() => endRound({ guessedBy: g.name, guessedBySide: g.side, reason: "guessed-after-time" })}>
                    ✅ {g.name} got it!
                  </motion.button>
                ))}
                <motion.button whileTap={{ scale: 0.95 }} style={bigBtn("rgba(255,255,255,0.2)", "#fff")}
                  onClick={() => endRound({ guessedBy: null, guessedBySide: null, reason: "time" })}>
                  🦗 Nope — total blank
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── REVEAL ── */}
          {phase === "reveal" && (
            <motion.div key="reveal" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "1.2rem", opacity: 0.7, letterSpacing: 2 }}>THE CLUE WAS...</div>
              <div style={{ fontSize: "3rem", fontWeight: 900, background: "rgba(0,0,0,0.3)", borderRadius: 24, padding: "24px 40px", maxWidth: 480, lineHeight: 1.3 }}>
                {prompt}
              </div>
              {lastWinner?.name ? (
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#4ade80" }}>
                  ✅ {lastWinner.name} got it! +{1 + (lastWinner.bonus || 0)} pts
                </div>
              ) : (
                <div style={{ fontSize: "1.5rem", fontWeight: 800, opacity: 0.75 }}>
                  🦗 Nobody got it this time!
                </div>
              )}
              <motion.button whileTap={{ scale: 0.95 }} style={bigBtn("#f59e0b", "#000")}
                onClick={() => setPhase("rate")}>
                Rate the performance 👏 →
              </motion.button>
            </motion.div>
          )}

          {/* ── RATE ── */}
          {phase === "rate" && (
            <motion.div key="rate" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>
                How was {performer?.name}&apos;s {mode === "draw" ? "drawing" : "performance"}?
              </div>
              <div style={{ opacity: 0.75 }}>Everyone tap your reaction — as many times as you like!</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
                {[
                  { emoji: "🔥", label: "On fire!" },
                  { emoji: "😂", label: "Hilarious!" },
                  { emoji: "🤔", label: "Huh??" },
                  { emoji: "💀", label: "Impossible!" },
                ].map(({ emoji, label }) => (
                  <motion.button key={emoji} whileTap={{ scale: 1.2 }}
                    style={{ background: "rgba(0,0,0,0.25)", border: "none", borderRadius: 20, padding: "16px 24px", cursor: "pointer", color: "#fff", minWidth: 100 }}
                    onClick={() => setRatings(r => ({ ...r, [emoji]: (r[emoji] || 0) + 1 }))}>
                    <div style={{ fontSize: "2.5rem" }}>{emoji}</div>
                    <div style={{ fontSize: "0.9rem", marginTop: 4, opacity: 0.85 }}>{label}</div>
                    {ratings[emoji] ? <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#facc15", marginTop: 4 }}>{ratings[emoji]}</div> : null}
                  </motion.button>
                ))}
              </div>
              <motion.button whileTap={{ scale: 0.95 }} style={bigBtn("#6366f1", "#fff")}
                onClick={() => setPhase("done")}>
                Done →
              </motion.button>
            </motion.div>
          )}

          {/* ── DONE ── */}
          {phase === "done" && (
            <motion.div key="done" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "3rem" }}>🎉</div>
              <div style={{ fontSize: "2rem", fontWeight: 900 }}>
                {totalRounds > 1 ? `Round ${roundIndex + 1} Complete!` : "Round Complete!"}
              </div>
              {topRatingEmoji && (
                <div style={{ fontSize: "1.4rem", opacity: 0.85 }}>
                  The crowd says: {topRatingEmoji} {[
                    { emoji: "🔥", label: "On fire!" }, { emoji: "😂", label: "Hilarious!" },
                    { emoji: "🤔", label: "Huh??" }, { emoji: "💀", label: "Impossible!" },
                  ].find(r => r.emoji === topRatingEmoji)?.label}
                </div>
              )}
              <div style={{ display: "flex", gap: 32, fontSize: "1.6rem", fontWeight: 900, background: "rgba(0,0,0,0.25)", borderRadius: 16, padding: "16px 32px" }}>
                <span>Left: {scoreLeft}</span>
                <span>Right: {scoreRight}</span>
              </div>
              {!isLastRound && (
                <div style={{ fontSize: "1rem", opacity: 0.7, marginTop: -8 }}>
                  Pass the device to the next player for Round {roundIndex + 2}
                </div>
              )}
              <motion.button whileTap={{ scale: 0.95 }}
                style={{ ...bigBtn(isLastRound ? "#22c55e" : "#f59e0b", isLastRound ? "#000" : "#000"), fontSize: "1.8rem" }}
                onClick={finishRound}>
                {isLastRound ? "Finish ✓" : `Round ${roundIndex + 2} →`}
              </motion.button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </TaskCardFrame>
  );
}
