// student-app/src/components/tasks/types/DrawMimeTask.jsx
import React, { useRef, useState, useEffect, useMemo } from "react";
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

    // Submit the round. For drawing: include the image. For mime: no image.
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

    if (mode !== "mime") {
      try {
        payload.imageData = canvasRef.current?.toDataURL?.() || null;
      } catch {
        payload.imageData = null;
      }
    }

    onSubmit?.(payload);
    nextPerformer();
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
    setAwaitingOutcome(true);
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

  const prompt = task?.prompt || "Draw with feeling! Use Apple Pencil or stylus for pressure magic!";

  return (
    <TaskCardFrame theme="dark" fullBleed showBackground={false}>
      <div className="flex flex-col h-full bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500 text-white">
        {/* Header */}
        <div className="p-6 text-center">
          <h2 className="text-5xl md:text-7xl font-black drop-shadow-2xl mb-4">
            DRAW OR MIME IT!
          </h2>
          <p className="text-3xl md:text-4xl font-bold drop-shadow-lg px-4">
            {roundActive
              ? prompt
              : performer
                ? `${mode === "draw" ? "Drawer" : "Actor"}: ${performer.name} — tap GO to reveal the clue`
                : "Tap GO to reveal the clue"}
          </p>

          <div className="mt-5 max-w-5xl mx-auto">
            {/* Two-column card: left = controls, right = how to play */}
            <div className="bg-black/35 backdrop-blur-lg rounded-3xl p-5 shadow-2xl border border-white/15 flex flex-col md:flex-row gap-5">

              {/* ── LEFT COLUMN: all the action ── */}
              <div className="flex-1 min-w-0">

                {/* 1. Mode toggle — FIRST so players pick before hitting GO */}
                <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setMode("draw")}
                    className={`px-6 py-3 rounded-2xl text-2xl font-black transition ${
                      mode === "draw"
                        ? "bg-blue-600 text-white ring-4 ring-blue-200 scale-105"
                        : "bg-white/85 text-black"
                    }`}
                  >
                    🎨 Drawing
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("mime")}
                    className={`px-6 py-3 rounded-2xl text-2xl font-black transition ${
                      mode === "mime"
                        ? "bg-purple-600 text-white ring-4 ring-purple-200 scale-105"
                        : "bg-white/85 text-black"
                    }`}
                  >
                    🤫 Miming
                  </button>
                </div>

                {/* 2. Timer + GO */}
                <div className="flex flex-wrap items-center justify-center gap-4 mb-4">
                  <div className="px-5 py-3 rounded-2xl bg-white/15 text-2xl font-black">
                    ⏱️ Time: {started ? `${timeLeft}s` : `${durationSeconds}s`}
                  </div>
                  <button
                    onClick={startRound}
                    disabled={disabled || !canStart || roundActive || countdown != null || awaitingOutcome}
                    className={`px-8 py-4 rounded-2xl text-3xl font-black transition ${
                      roundActive
                        ? "bg-green-600 text-white"
                        : "bg-green-500 text-white border-2 border-green-200 hover:scale-105"
                    } disabled:opacity-40`}
                  >
                    {!canStart
                      ? "Intro…"
                      : roundActive
                        ? "GO!"
                        : countdown
                          ? String(countdown)
                          : "1-2-3 GO!"}
                  </button>
                </div>

                {!canStart && (
                  <div className="text-center text-xl font-bold opacity-80 mb-2">
                    Intro playing… Start will appear in a moment.
                  </div>
                )}

                {/* 3. Guessed it! + Turnkeeper */}
                <div className="mt-2 mb-2">
                  {roundActive && (
                    <div className="flex justify-center mb-4">
                      <button
                        type="button"
                        onClick={() =>
                          endRound({
                            guessedBy: `${guessingSide === "left" ? "Left" : "Right"} Team`,
                            guessedBySide: guessingSide,
                            reason: "guessed",
                          })
                        }
                        className="px-8 py-5 rounded-3xl text-3xl font-black bg-green-400 text-black shadow-2xl hover:scale-105 active:scale-95 transition"
                        style={{ minWidth: 220 }}
                      >
                        ✅ Guessed it!
                      </button>
                    </div>
                  )}

                  <div className="text-xl font-black text-center mb-3 opacity-90">
                    {mode === "draw" ? "Drawer" : "Actor"}:{" "}
                    <span className="underline">{performer?.name || "Player"}</span>
                    {" "}· Guessing team: {guessingSide === "left" ? "Left" : "Right"}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Left Team */}
                    <div
                      className={`relative rounded-3xl p-3 border border-white/15 shadow-xl transition ${
                        performerSide === "left" ? "bg-emerald-500/20" : "bg-white/10"
                      } ${turnPulse && performerSide === "left" ? "animate-pulse" : ""}`}
                    >
                      {performerSide === "left" && (
                        <div className="absolute -top-3 -left-3 bg-emerald-500 text-black font-black px-3 py-1 rounded-2xl shadow-xl text-sm">
                          YOUR TURN ➜
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-2xl font-black">Left</div>
                        <div className="text-2xl font-black">{scoreLeft}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {players
                          .map((p, idx) => ({ ...p, idx, side: sideForIndex(idx) }))
                          .filter((p) => p.side === "left")
                          .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                if (!roundActive) return;
                                if (p.idx === performerIdx) return;
                                if (p.side !== guessingSide) return;
                                markGuessed(p);
                              }}
                              disabled={disabled || !roundActive || p.idx === performerIdx || p.side !== guessingSide}
                              className={`px-3 py-2 rounded-xl text-lg font-black transition ${
                                p.idx === performerIdx
                                  ? "bg-white/15 opacity-70"
                                  : p.side === guessingSide
                                    ? "bg-white text-black hover:scale-105"
                                    : "bg-white/10 opacity-50"
                              }`}
                              title={
                                p.idx === performerIdx
                                  ? "Performer"
                                  : p.side === guessingSide
                                    ? "Tap if this person guessed it!"
                                    : "Not the guessing team this round"
                              }
                            >
                              {p.name}
                              {p.idx === performerIdx ? " (performing)" : ""}
                            </button>
                          ))}
                      </div>
                    </div>

                    {/* Right Team */}
                    <div
                      className={`relative rounded-3xl p-3 border border-white/15 shadow-xl transition ${
                        performerSide === "right" ? "bg-sky-500/20" : "bg-white/10"
                      } ${turnPulse && performerSide === "right" ? "animate-pulse" : ""}`}
                    >
                      {performerSide === "right" && (
                        <div className="absolute -top-3 -right-3 bg-sky-500 text-black font-black px-3 py-1 rounded-2xl shadow-xl text-sm">
                          ⬅ YOUR TURN
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-2xl font-black">Right</div>
                        <div className="text-2xl font-black">{scoreRight}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {players
                          .map((p, idx) => ({ ...p, idx, side: sideForIndex(idx) }))
                          .filter((p) => p.side === "right")
                          .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                if (!roundActive) return;
                                if (p.idx === performerIdx) return;
                                if (p.side !== guessingSide) return;
                                markGuessed(p);
                              }}
                              disabled={disabled || !roundActive || p.idx === performerIdx || p.side !== guessingSide}
                              className={`px-3 py-2 rounded-xl text-lg font-black transition ${
                                p.idx === performerIdx
                                  ? "bg-white/15 opacity-70"
                                  : p.side === guessingSide
                                    ? "bg-white text-black hover:scale-105"
                                    : "bg-white/10 opacity-50"
                              }`}
                            >
                              {p.name}
                              {p.idx === performerIdx ? " (performing)" : ""}
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>

                  {lastWinner && (
                    <div className="mt-3 text-center text-2xl font-black">
                      {lastWinner?.name
                        ? `✅ ${lastWinner.name} guessed it! Bonus: +${lastWinner.bonus}`
                        : "⏱️ Time's up! Next performer."}
                    </div>
                  )}
                </div>
              </div>

              {/* ── RIGHT COLUMN: How to Play ── */}
              <div className="md:w-52 shrink-0 bg-white/10 rounded-2xl p-4 text-lg leading-relaxed self-start">
                <div className="font-black text-xl mb-2">
                  {mode === "draw" ? "🎨 Drawing" : "🤫 Miming"}
                </div>
                {mode === "draw" ? (
                  <ul className="space-y-2 list-none m-0 p-0">
                    <li>✏️ Draw the clue on the screen.</li>
                    <li>🚫 No letters or words.</li>
                    <li>👆 Your team taps <strong>Guessed it!</strong> as soon as they know.</li>
                  </ul>
                ) : (
                  <ul className="space-y-2 list-none m-0 p-0">
                    <li>🤫 Act out the clue — no speaking.</li>
                    <li>📱 Put the device down and mime it.</li>
                    <li>👆 Your team taps <strong>Guessed it!</strong> as soon as they know.</li>
                  </ul>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Canvas */}
        {mode === "draw" ? (
          <div className="flex-1 relative mx-4 mb-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-full touch-none"
              onPointerDown={startDrawing}
              style={{ touchAction: "none" }}
            />

            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-6xl font-black text-gray-300 opacity-50">
                  Press hard for thick lines!
                </p>
              </div>
            )}

            {countdown != null && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="text-8xl md:text-9xl font-black text-white drop-shadow-2xl">
                  {String(countdown)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 relative mx-4 mb-4 rounded-3xl shadow-2xl overflow-hidden bg-black/25 border border-white/15 flex items-center justify-center">
            <div className="text-center px-8">
              <div className="text-6xl mb-4">🤫</div>
              <div className="text-4xl font-black">Mime Mode</div>
              <div className="text-2xl mt-3 opacity-90">
                Put the device down and act it out for your team.
              </div>
              {countdown != null && (
                <div className="mt-8 text-8xl md:text-9xl font-black text-white drop-shadow-2xl">
                  {String(countdown)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom controls / actions */}
        <div className="p-6 bg-black/40 backdrop-blur-lg">
          {mode === "draw" && (
            <div className="flex flex-wrap items-center justify-center gap-6 mb-6">
              {/* Tool Switcher */}
              <div className="flex bg-white/20 rounded-2xl p-2">
                <button
                  onClick={() => setTool("pen")}
                  disabled={disabled}
                  className={`px-8 py-4 rounded-xl text-3xl font-bold transition ${
                    tool === "pen" ? "bg-white text-black" : "text-white"
                  }`}
                >
                  Pen
                </button>
                <button
                  onClick={() => setTool("eraser")}
                  disabled={disabled}
                  className={`px-8 py-4 rounded-xl text-3xl font-bold transition ${
                    tool === "eraser" ? "bg-white text-black" : "text-white"
                  }`}
                >
                  Eraser
                </button>
              </div>

              {/* Undo / Redo */}
              <div className="flex gap-4">
                <button
                  onClick={undo}
                  disabled={!canUndo || disabled}
                  className="px-8 py-5 bg-white/20 rounded-2xl text-4xl hover:bg-white/30 disabled:opacity-30 transition"
                >
                  Undo
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo || disabled}
                  className="px-8 py-5 bg-white/20 rounded-2xl text-4xl hover:bg-white/30 disabled:opacity-30 transition"
                >
                  Redo
                </button>
              </div>

              {/* Color Palette */}
              {["#000000", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"].map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setColor(c);
                    setTool("pen");
                  }}
                  disabled={disabled}
                  className={`w-16 h-16 rounded-full shadow-xl transition transform hover:scale-110 ${
                    color === c && tool === "pen" ? "ring-8 ring-white scale-125" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}

              {/* Brush Size */}
              <div className="flex items-center gap-4 bg-white/20 rounded-2xl px-6 py-3">
                <span className="text-2xl">Brush</span>
                {[4, 8, 12, 20].map((w) => (
                  <button
                    key={w}
                    onClick={() => setLineWidth(w)}
                    disabled={disabled}
                    className={`rounded-full transition hover:scale-125 ${
                      lineWidth === w ? "bg-white scale-125" : "bg-gray-400"
                    }`}
                    style={{
                      width: w === 4 ? 40 : w === 8 ? 48 : w === 12 ? 56 : 64,
                      height: w === 4 ? 40 : w === 8 ? 48 : w === 12 ? 56 : 64,
                    }}
                  />
                ))}
              </div>

              {/* Clear */}
              <button
                onClick={clearCanvas}
                disabled={disabled}
                className="px-8 py-4 bg-red-600 text-white text-2xl font-bold rounded-2xl hover:bg-red-700 transition shadow-xl"
              >
                Clear All
              </button>
            </div>
          )}

          {awaitingOutcome && (
            <div className="mb-6 flex flex-col items-center gap-4">
              <div className="text-3xl font-black text-center">
                Time's up — did the team guess it?
              </div>

              <div className="flex flex-wrap justify-center gap-4">
                {guessers.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setAwaitingOutcome(false);
                      endRound({
                        guessedBy: g.name,
                        guessedBySide: g.side,
                        reason: "guessed-after-time",
                      });
                    }}
                    className="px-6 py-4 rounded-2xl text-2xl font-black bg-white text-black hover:scale-105 transition"
                  >
                    ✅ {g.name} guessed it
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setAwaitingOutcome(false);
                    endRound({ guessedBy: null, guessedBySide: null, reason: "time" });
                  }}
                  className="px-6 py-4 rounded-2xl text-2xl font-black bg-red-600 text-white hover:bg-red-700 transition"
                >
                  ❌ No guess
                </button>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={
              disabled ||
              awaitingOutcome ||
              !roundActive ||
              (mode === "draw" ? !hasDrawn : false)
            }
            className="w-full py-8 text-6xl font-black bg-gradient-to-r from-green-500 to-emerald-600 rounded-3xl shadow-2xl hover:scale-105 transition disabled:opacity-50"
          >
            {roundActive
              ? mode === "draw"
                ? hasDrawn
                  ? "END ROUND (SUBMIT DRAWING)"
                  : "DRAW FIRST!"
                : "END ROUND"
              : "START WITH 1-2-3 GO"}
          </button>
        </div>
      </div>
    </TaskCardFrame>
  );
}
