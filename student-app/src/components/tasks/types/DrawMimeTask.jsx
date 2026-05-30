// student-app/src/components/tasks/types/DrawMimeTask.jsx
import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TaskCardFrame } from "../taskStyles";
import TaskInstructions from "../TaskInstructions";

// ─── Inline drawing canvas (simple-mode "Draw on screen" option) ──────
//
// Finger / mouse / stylus drawing.  Used by simple-mode draw tasks
// when the player picks "Draw on screen".  Paper drawing is still the
// default and earns a bonus.  Teacher profile flag minimizeOnScreen
// hides the on-screen choice entirely so a classroom can stay
// paper-only by policy.
const SIMPLE_DRAW_COLOURS = [
  { name: "Black",  css: "#0f172a" },
  { name: "Red",    css: "#ef4444" },
  { name: "Blue",   css: "#2563eb" },
  { name: "Green",  css: "#16a34a" },
  { name: "Orange", css: "#f97316" },
  { name: "Purple", css: "#7c3aed" },
];
const SIMPLE_DRAW_SIZES = [
  { label: "Fine",   px: 3 },
  { label: "Medium", px: 6 },
  { label: "Bold",   px: 12 },
];

function SimpleDrawCanvas({ onClear, registerSnapshot }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const [colour, setColour] = useState(SIMPLE_DRAW_COLOURS[0].css);
  const [sizePx, setSizePx] = useState(SIMPLE_DRAW_SIZES[1].px);
  const strokeHistoryRef = useRef([]); // stack of dataURL snapshots for undo

  // Resize the canvas to its container so the drawing surface matches
  // the visible box on any device.  Also fills with white so the
  // captured snapshot reads as a "real" drawing on a page.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      // Preserve any existing drawing across resizes.
      const prev = strokeHistoryRef.current[strokeHistoryRef.current.length - 1] || null;
      c.width = Math.max(200, Math.floor(rect.width * dpr));
      c.height = Math.max(180, Math.floor(rect.height * dpr));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctxRef.current = ctx;
      if (prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
        img.src = prev;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const getPos = useCallback((evt) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const clientX = evt.clientX ?? evt.touches?.[0]?.clientX ?? 0;
    const clientY = evt.clientY ?? evt.touches?.[0]?.clientY ?? 0;
    return {
      x: (clientX - rect.left) * dpr,
      y: (clientY - rect.top) * dpr,
    };
  }, []);

  const start = useCallback(
    (evt) => {
      evt.preventDefault();
      const ctx = ctxRef.current;
      if (!ctx) return;
      drawingRef.current = true;
      const { x, y } = getPos(evt);
      lastRef.current = { x, y };
      ctx.strokeStyle = colour;
      ctx.lineWidth = sizePx * (Math.max(1, window.devicePixelRatio || 1));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.01, y + 0.01); // dot for tap-only
      ctx.stroke();
    },
    [colour, sizePx, getPos]
  );

  const move = useCallback(
    (evt) => {
      if (!drawingRef.current) return;
      evt.preventDefault();
      const ctx = ctxRef.current;
      if (!ctx) return;
      const { x, y } = getPos(evt);
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastRef.current = { x, y };
    },
    [getPos]
  );

  const end = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const c = canvasRef.current;
    if (!c) return;
    try {
      const snap = c.toDataURL("image/png");
      strokeHistoryRef.current.push(snap);
      if (strokeHistoryRef.current.length > 20) strokeHistoryRef.current.shift();
    } catch {}
  }, []);

  const handleClear = useCallback(() => {
    const c = canvasRef.current;
    const ctx = ctxRef.current;
    if (!c || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    strokeHistoryRef.current = [];
    if (typeof onClear === "function") onClear();
  }, [onClear]);

  const handleUndo = useCallback(() => {
    const c = canvasRef.current;
    const ctx = ctxRef.current;
    if (!c || !ctx) return;
    const history = strokeHistoryRef.current;
    if (history.length === 0) return;
    history.pop();
    const prev = history[history.length - 1];
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (prev) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = prev;
    }
  }, []);

  // Expose a snapshot fetch to the parent so the submit handler can
  // include the dataURL in the answer payload.
  useEffect(() => {
    if (typeof registerSnapshot === "function") {
      registerSnapshot(() => {
        const c = canvasRef.current;
        if (!c) return null;
        try {
          return c.toDataURL("image/png");
        } catch {
          return null;
        }
      });
    }
    return () => {
      if (typeof registerSnapshot === "function") registerSnapshot(null);
    };
  }, [registerSnapshot]);

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {SIMPLE_DRAW_COLOURS.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => setColour(c.css)}
            aria-label={`Colour ${c.name}`}
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: c.css,
              border:
                colour === c.css
                  ? "3px solid #fff"
                  : "2px solid rgba(255,255,255,0.45)",
              cursor: "pointer",
              boxShadow:
                colour === c.css
                  ? "0 0 0 2px rgba(0,0,0,0.3), 0 0 12px rgba(255,255,255,0.5)"
                  : "0 1px 3px rgba(0,0,0,0.25)",
            }}
          />
        ))}
        <span style={{ width: 1, height: 22, background: "rgba(255,255,255,0.3)" }} />
        {SIMPLE_DRAW_SIZES.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setSizePx(s.px)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border:
                sizePx === s.px
                  ? "2px solid #fff"
                  : "1px solid rgba(255,255,255,0.35)",
              background:
                sizePx === s.px ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: 320,
          maxWidth: 520,
          marginInline: "auto",
          borderRadius: 16,
          background: "#ffffff",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          touchAction: "none",
          cursor: "crosshair",
        }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={handleUndo}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.4)",
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ↶ Undo
        </button>
        <button
          type="button"
          onClick={handleClear}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.4)",
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          🧽 Clear
        </button>
      </div>
    </div>
  );
}

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
  // ── Simple mode for standalone "draw" or "mime" tasks ──
  // These are non-competitive, off-tablet activities: show prompt + clue list, done.
  const taskType = String(task?.taskType || "").toLowerCase();
  const isSimpleMode = taskType === "draw" || taskType === "mime";
  const isDrawOnly = taskType === "draw";
  const isMimeOnly = taskType === "mime";
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

  // Simple-mode state (for standalone "draw" or "mime" tasks)
  const [simpleDone, setSimpleDone] = useState(false);
  const [simpleCurrentIdx, setSimpleCurrentIdx] = useState(0);

  // Draw-on-paper (+bonus) vs draw-on-screen entry choice.  Null
  // until the player picks.  Teacher profile flag minimizeOnScreen
  // forces "paper" automatically so the on-screen option doesn't
  // appear when the class policy is paper-only.
  const teacherMinimizeOnScreen =
    !!task?.minimizeOnScreen || !!task?.config?.minimizeOnScreen;
  const PAPER_DRAW_BONUS = 5;
  const [drawMethod, setDrawMethod] = useState(
    teacherMinimizeOnScreen ? "paper" : null
  );
  // Snapshot getter the canvas registers so submit can include the
  // dataURL in the answer payload.
  const drawSnapshotRef = useRef(null);
  const registerDrawSnapshot = useCallback((fn) => {
    drawSnapshotRef.current = fn || null;
  }, []);
  // Mime/Draw simple-mode: per-clue peek-and-hide state machine.  The
  // clue is hidden by default so the team doesn't see it on the
  // device — the actor presses & holds to peek privately, then taps
  // "Got it — start", which hides the clue and shows the "Who
  // guessed?" panel.  Tester request to mirror the speed-draw flow.
  const [simplePhase, setSimplePhase] = useState("peek"); // "peek" | "acting"
  const [simplePeeking, setSimplePeeking] = useState(false);
  const [simpleGuesses, setSimpleGuesses] = useState([]); // [{ idx, guesser }]
  // Per-task random rotation offset so the FIRST clue's actor isn't
  // always the first roster name.  Tester: 'a player nominated (not
  // always the first player, btw)'.  Seeded from the task id so the
  // same task gives the same offset across reloads (deterministic
  // for class playback) but DIFFERENT tasks pick different starters.
  const simpleActorOffset = useMemo(() => {
    const seedSrc = String(task?.id || task?._id || task?.title || "dm");
    let h = 0;
    for (let i = 0; i < seedSrc.length; i += 1) h = (h * 31 + seedSrc.charCodeAt(i)) | 0;
    return Math.abs(h);
  }, [task?.id, task?._id, task?.title]);
  // Per-clue manual override of the actor (tap "Switch actor" in peek).
  // Map<simpleCurrentIdx, actorIdx>.
  const [simpleActorOverride, setSimpleActorOverride] = useState({});

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

  // ── Clues for each round ──
  const clues = useMemo(() => {
    const MIN_CLUE_CHARS = 3;
    const MAX_CLUE_WORDS = 5;
    const MAX_CLUE_CHARS = 40;
    // Words that indicate a task title / category, not a drawable clue
    const TITLE_WORDS = /\b(vocabulary|vocab|review|quiz|test|activity|task|exercise|assignment|history|science|math|english|french|chapter|unit|lesson|draw|mime|practice)\b/i;
    const isValidClue = (s) => {
      if (!s) return false;
      const t = s.trim();
      if (!t || t.length < MIN_CLUE_CHARS || t.length > MAX_CLUE_CHARS) return false;
      if (t.split(/\s+/).length > MAX_CLUE_WORDS) return false;
      // Reject generic task titles / category names
      if (TITLE_WORDS.test(t)) return false;
      return true;
    };

    // 1. Try clues array (backend-normalised — should already be clean vocab words)
    let arr = Array.isArray(task?.clues) && task.clues.length > 0
      ? task.clues.map((c) => String(c || "").trim()).filter(Boolean).filter(isValidClue)
      : [];

    // 2. Try vocabulary / word list from the task (teacher's own words)
    if (!arr.length) {
      const wordSources = [
        task?.words, task?.config?.words,
        task?.vocabulary, task?.config?.vocabulary,
        task?.requiredWords, task?.config?.requiredWords,
        task?.wordList, task?.config?.wordList,
        task?.concepts, task?.config?.concepts,
        task?.terms, task?.config?.terms,
        task?.items, task?.config?.items,
        task?.statements, task?.config?.statements,
      ];
      const extractText = (w) => {
        if (typeof w === "string") return w.trim();
        if (w && typeof w === "object") return String(w.text || w.word || w.term || w.statement || w.clue || w.concept || w.name || "").trim();
        return "";
      };
      for (const src of wordSources) {
        if (Array.isArray(src) && src.length > 0) {
          arr = src.map(extractText).filter(Boolean).filter(isValidClue);
          if (arr.length) break;
        }
      }
    }

    // 3. Try prompt as single clue (if short enough and not a sentence fragment)
    if (!arr.length) {
      const p = String(task?.prompt || "").trim();
      if (p && isValidClue(p) && !p.toLowerCase().startsWith("a ") && !p.toLowerCase().startsWith("the ")) {
        arr = [p];
      }
    }

    // 4. Try title
    if (!arr.length) {
      const title = String(task?.title || "").trim();
      if (title && isValidClue(title)) {
        arr = [title];
      }
    }

    // 5. Final fallback
    return arr.length > 0 ? arr : ["Draw or Mime"];
  }, [task]);

  // Rounds = ~2 turns per player (each player performs twice), capped by the
  // number of distinct clues so we don't force repeats. Tester saw 20 rounds
  // because this used to fall back to clues.length when the roster was empty —
  // now it's always player-count driven (default 4 in solo/practice).
  const [roundIndex, setRoundIndex] = useState(0);
  const _rosterCount = (Array.isArray(memberNames) ? memberNames.filter(Boolean).length : 0) || 4;
  const PERFORMANCES_PER_PLAYER = 2;
  const totalRounds = Math.max(
    1,
    Math.min(Math.max(clues.length, 1), _rosterCount * PERFORMANCES_PER_PLAYER)
  );
  const currentClue = clues[roundIndex % clues.length]; // cycle through clues if fewer than rounds
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

  // Seed initial performer from the task so different tasks start with different players
  const initialPerformerIdx = useMemo(() => {
    const n = players.length;
    if (n <= 1) return 0;
    const seed = String(task?.id || task?._id || task?.prompt || "dm");
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    return Math.abs(h) % n;
  }, [task?.id, task?._id, task?.prompt, players.length]);

  const [performerIdx, setPerformerIdx] = useState(initialPerformerIdx);
  // Track who has already performed so we never repeat until the pool resets.
  const performedSetRef = useRef(new Set([initialPerformerIdx]));
  const [teamScore, setTeamScore] = useState(0);
  const [lastWinner, setLastWinner] = useState(null); // { name, bonus }

  // UI pulse when turn changes
  const [turnPulse, setTurnPulse] = useState(false);
  const prevPerformerRef = useRef(performerIdx);

  const performer = players[Math.max(0, Math.min(players.length - 1, performerIdx))];
  const performerSide = sideForIndex(performerIdx);
  const guessingSide = turnStyle === "intra" ? performerSide : performerSide === "left" ? "right" : "left";

  const guessers = useMemo(() => {
    const allNonPerformers = players
      .map((p, idx) => ({ ...p, idx, side: sideForIndex(idx) }))
      .filter((p) => p.idx !== performerIdx);
    // Prefer the opposing-side players; fall back to ALL non-performers so we
    // always show named buttons (never the generic "Guessed it!" fallback).
    const sidedGuessers = allNonPerformers.filter((p) => p.side === guessingSide);
    return sidedGuessers.length > 0 ? sidedGuessers : allNonPerformers;
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

  const bumpScore = (_side, delta) => {
    setTeamScore((n) => (Number(n) || 0) + (Number(delta) || 0));
  };

  const nextPerformer = () => {
    const n = players.length;
    if (n <= 1) return;

    // Mark current performer as done.
    performedSetRef.current.add(performerIdx);

    // If everyone has performed, reset the pool (keeping the current as seed
    // so they won't be picked immediately next cycle).
    if (performedSetRef.current.size >= n) {
      performedSetRef.current = new Set([performerIdx]);
    }

    // Build pool of remaining available players.
    const available = [];
    for (let i = 0; i < n; i++) {
      if (!performedSetRef.current.has(i)) available.push(i);
    }

    // Pick randomly from the remaining pool.
    const nextIdx = available[Math.floor(Math.random() * available.length)];
    setPerformerIdx(nextIdx);
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
      // Award team points: base 1 + time bonus (0–3)
      bumpScore(null, 1 + bonus);
      setLastWinner({ name: guessedBy, bonus });
    } else {
      setLastWinner({ name: null, bonus: 0, reason: reason || "time" });
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
      // All rounds done — submit once (include cumulative team scores for backend)
      onSubmit?.({ ...payload, roundIndex, totalRounds, allRoundsDone: true, teamScore });
      // Reset round counter for if the task somehow restarts
      setRoundIndex(0);
      setPerformerIdx(initialPerformerIdx);
      performedSetRef.current = new Set([initialPerformerIdx]);
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

  // ── SIMPLE MODE: standalone draw or mime ──
  // No game wizard, no timer, no scoring — just show what to draw/mime and let them submit.
  if (isSimpleMode) {
    const simpleClues = clues.filter(c => c !== "Draw or Mime");
    const simplePrompt = String(task?.prompt || "").trim();

    const handleSimpleSubmit = () => {
      if (disabled || simpleDone) return;
      setSimpleDone(true);
      // For draw tasks, include the chosen method + any on-screen
      // canvas snapshot + the paper bonus (if applicable).  DemoMode
      // / TaskRunner can apply paperBonus to the awarded points.
      const drawingPayload = {};
      if (isDrawOnly) {
        const effectiveMethod = drawMethod || "paper"; // default to paper
        drawingPayload.drawingMethod = effectiveMethod;
        if (effectiveMethod === "paper") {
          drawingPayload.paperBonus = PAPER_DRAW_BONUS;
        } else if (effectiveMethod === "screen") {
          try {
            const snap = drawSnapshotRef.current?.();
            if (snap) drawingPayload.drawingDataUrl = snap;
          } catch {}
        }
      }
      onSubmit?.({
        type: isDrawOnly ? "drawing" : "mime",
        mode: isDrawOnly ? "draw" : "mime",
        completed: true,
        simple: true,
        ...drawingPayload,
      });
    };

    const hasMultipleClues = simpleClues.length > 1;

    return (
      <TaskCardFrame theme="dark" fullBleed showBackground={false}>
        <div style={{
          display: "flex", flexDirection: "column", height: "100%", overflow: "auto",
          background: isDrawOnly
            ? "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)"
            : "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%)",
          color: "#fff", padding: 24,
        }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: "3rem", marginBottom: 4 }}>
              {isDrawOnly ? "🎨" : "🤫"}
            </div>
            <div style={{ fontSize: "1.8rem", fontWeight: 900, textShadow: "0 3px 12px rgba(0,0,0,0.3)" }}>
              {task?.title || (isDrawOnly ? "Draw It!" : "Act It Out!")}
            </div>
            {simplePrompt && simplePrompt !== simpleClues[0] && (
              <div style={{ fontSize: "1.1rem", opacity: 0.95, marginTop: 8, maxWidth: 480, marginInline: "auto" }}>
                {simplePrompt}
              </div>
            )}
          </div>

          {/* Method picker — drawing only.  Hidden once chosen,
              hidden entirely when teacher profile has
              minimizeOnScreen (paper is forced) or for mime tasks. */}
          {isDrawOnly && !drawMethod && !teacherMinimizeOnScreen && (
            <div
              style={{
                background: "rgba(0,0,0,0.25)",
                borderRadius: 16,
                padding: 16,
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: 10 }}>
                How are you drawing?
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setDrawMethod("paper")}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 14,
                    border: "2px solid rgba(253,224,71,0.85)",
                    background: "rgba(253,224,71,0.18)",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: "0.95rem",
                    cursor: "pointer",
                    minWidth: 180,
                    textAlign: "left",
                  }}
                >
                  📝 On paper
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.95, marginTop: 4 }}>
                    +{PAPER_DRAW_BONUS} pt bonus · brain & hand together
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawMethod("screen")}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 14,
                    border: "2px solid rgba(255,255,255,0.45)",
                    background: "rgba(255,255,255,0.10)",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: "0.95rem",
                    cursor: "pointer",
                    minWidth: 180,
                    textAlign: "left",
                  }}
                >
                  🖍 On screen
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.85, marginTop: 4 }}>
                    Finger or stylus drawing
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div style={{
            background: "rgba(0,0,0,0.2)",
            borderRadius: 16,
            padding: "14px 20px",
            marginBottom: 20,
            textAlign: "center",
          }}>
            {isDrawOnly ? (
              <div style={{ fontSize: "1rem", lineHeight: 1.6 }}>
                {drawMethod === "screen" ? (
                  <>
                    <strong>Draw on screen.</strong> Use the canvas
                    below — no words or letters allowed!
                  </>
                ) : (
                  <>
                    <strong>
                      Grab paper and a pen.
                      {drawMethod === "paper" && (
                        <span style={{ color: "#fde68a" }}>
                          {" "}(+{PAPER_DRAW_BONUS} pt bonus)
                        </span>
                      )}
                    </strong>{" "}
                    Draw each concept below — no words or letters
                    allowed!
                    {teacherMinimizeOnScreen && (
                      <div style={{ marginTop: 6, fontSize: "0.85rem", opacity: 0.85 }}>
                        Your teacher has set this class to paper-only.
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: "1rem", lineHeight: 1.6 }}>
                <strong>Stand up and act it out!</strong> No talking, no sounds — use only body movements and gestures.
              </div>
            )}
          </div>

          {/* On-screen canvas — appears only when player chose
              "screen".  Tucked right above the clue display so
              they can glance at the clue and draw in one view. */}
          {isDrawOnly && drawMethod === "screen" && (
            <div style={{ marginBottom: 18 }}>
              <SimpleDrawCanvas registerSnapshot={registerDrawSnapshot} />
            </div>
          )}

          {/* Clue display */}
          {hasMultipleClues ? (() => {
            // Mime simple-mode now uses the same secret-reveal pattern
            // as speed-draw / role-play: clue is hidden by default,
            // actor presses & holds to peek, taps "Got it — start" to
            // act, then team taps who guessed.  Draw stays open
            // (the drawer is at paper anyway, so screen visibility
            // matters less).
            const teamNames = (Array.isArray(memberNames) ? memberNames : [])
              .map((n) => String(n || "").trim())
              .filter(Boolean);
            const fallbackActorIdx =
              (simpleCurrentIdx + simpleActorOffset) % Math.max(1, teamNames.length || 1);
            const actorIdx =
              typeof simpleActorOverride[simpleCurrentIdx] === "number"
                ? simpleActorOverride[simpleCurrentIdx]
                : fallbackActorIdx;
            const actorName = teamNames[actorIdx] || `Player ${actorIdx + 1}`;
            const useSecretReveal = isMimeOnly;
            const advanceClue = (guesser) => {
              setSimpleGuesses((prev) => [
                ...prev,
                { idx: simpleCurrentIdx, clue: simpleClues[simpleCurrentIdx], guesser: guesser || null },
              ]);
              if (simpleCurrentIdx < simpleClues.length - 1) {
                setSimpleCurrentIdx((i) => i + 1);
                setSimplePhase("peek");
                setSimplePeeking(false);
              } else {
                handleSimpleSubmit();
              }
            };

            return (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 700, opacity: 0.85, letterSpacing: 1, textTransform: "uppercase" }}>
                {isDrawOnly ? "Draw" : "Act out"} {simpleCurrentIdx + 1} of {simpleClues.length}
              </div>

              {/* PEEK phase (mime simple) — clue hidden, actor presses to peek. */}
              {useSecretReveal && simplePhase === "peek" && (
                <>
                  {teamNames.length > 0 && (
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fde68a", textAlign: "center" }}>
                      📲 Pass to <span style={{ color: "#fff" }}>{actorName}</span>
                    </div>
                  )}

                  {/* Manual actor picker — tap a different name if you'd
                      rather someone else act this one out.  Visible
                      until the actor peeks; locked once they see the clue. */}
                  {teamNames.length > 1 && !simplePeeking && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.75, alignSelf: "center" }}>
                        Switch actor:
                      </span>
                      {teamNames.map((nm, i) => (
                        <button
                          key={`${nm}-${i}`}
                          type="button"
                          onClick={() =>
                            setSimpleActorOverride((prev) => ({
                              ...prev,
                              [simpleCurrentIdx]: i,
                            }))
                          }
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.4)",
                            background: i === actorIdx ? "rgba(253,224,71,0.85)" : "rgba(255,255,255,0.10)",
                            color: i === actorIdx ? "#1f2937" : "#fff",
                            fontWeight: 800,
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          {i === actorIdx ? "✓ " : ""}{nm}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{
                    background: simplePeeking ? "rgba(253,224,71,0.95)" : "rgba(0,0,0,0.3)",
                    color: simplePeeking ? "#1f2937" : "#fff",
                    borderRadius: 24,
                    padding: "28px 36px",
                    fontSize: "2.2rem",
                    fontWeight: 900,
                    textAlign: "center",
                    maxWidth: 440,
                    width: "100%",
                    minHeight: 80,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1.3,
                    userSelect: "none",
                  }}>
                    {simplePeeking ? simpleClues[simpleCurrentIdx] : "🤫 hidden"}
                  </div>
                  <button
                    onMouseDown={() => setSimplePeeking(true)}
                    onMouseUp={() => setSimplePeeking(false)}
                    onMouseLeave={() => setSimplePeeking(false)}
                    onTouchStart={(e) => { e.preventDefault(); setSimplePeeking(true); }}
                    onTouchEnd={() => setSimplePeeking(false)}
                    style={{
                      padding: "14px 24px", borderRadius: 14, border: "none",
                      background: "#f59e0b", color: "#1f2937",
                      fontSize: "1.05rem", fontWeight: 900, cursor: "pointer",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
                      userSelect: "none",
                    }}
                  >
                    {simplePeeking ? "👀 PEEKING — release to hide" : "👇 Press & hold to peek"}
                  </button>
                  <button
                    onClick={() => { setSimplePhase("acting"); setSimplePeeking(false); }}
                    style={{
                      padding: "12px 22px", borderRadius: 14, border: "none",
                      background: "#22c55e", color: "#000",
                      fontSize: "1rem", fontWeight: 900, cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                    }}
                  >
                    Got it — start acting!
                  </button>
                </>
              )}

              {/* ACTING phase — clue hidden, team guesses, tap who got it. */}
              {useSecretReveal && simplePhase === "acting" && (
                <>
                  <div style={{
                    background: "rgba(0,0,0,0.3)",
                    color: "#fff",
                    borderRadius: 24,
                    padding: "20px 28px",
                    fontSize: "1.2rem",
                    fontWeight: 800,
                    maxWidth: 440,
                    textAlign: "center",
                  }}>
                    🤫 {actorName} is acting — team, guess out loud!
                  </div>
                  <div style={{ fontSize: "1rem", fontWeight: 800, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
                    Who got it?
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                    {teamNames.length > 0
                      ? teamNames.map((n, i) =>
                          i === actorIdx ? null : (
                            <button
                              key={n}
                              onClick={() => advanceClue(n)}
                              style={{
                                padding: "10px 18px", borderRadius: 999, border: "none",
                                background: "#22c55e", color: "#000",
                                fontWeight: 900, fontSize: "0.95rem",
                                cursor: "pointer",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                              }}
                            >
                              ✅ {n}
                            </button>
                          )
                        )
                      : (
                        <button
                          onClick={() => advanceClue("Team")}
                          style={{
                            padding: "10px 22px", borderRadius: 999, border: "none",
                            background: "#22c55e", color: "#000",
                            fontWeight: 900, fontSize: "1rem", cursor: "pointer",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                          }}
                        >
                          ✅ Team got it
                        </button>
                      )}
                    <button
                      onClick={() => advanceClue(null)}
                      style={{
                        padding: "10px 18px", borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.4)",
                        background: "transparent", color: "#fff",
                        fontWeight: 800, fontSize: "0.95rem",
                        cursor: "pointer",
                      }}
                    >
                      🦗 Skip — no one
                    </button>
                  </div>
                </>
              )}

              {/* DRAW simple-mode keeps the original openly-shown carousel
                  (drawer is at paper, not on screen). */}
              {!useSecretReveal && (
                <div style={{
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: 24,
                  padding: "28px 36px",
                  fontSize: "2.2rem",
                  fontWeight: 900,
                  textAlign: "center",
                  maxWidth: 440,
                  width: "100%",
                  minHeight: 80,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1.3,
                }}>
                  {simpleClues[simpleCurrentIdx]}
                </div>
              )}

              {!useSecretReveal && (
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  {simpleCurrentIdx > 0 && (
                    <button
                      onClick={() => setSimpleCurrentIdx(i => i - 1)}
                      style={{
                        padding: "12px 24px", borderRadius: 14, border: "none",
                        background: "rgba(255,255,255,0.2)", color: "#fff",
                        fontSize: "1rem", fontWeight: 700, cursor: "pointer",
                      }}>
                      ← Previous
                    </button>
                  )}
                  {simpleCurrentIdx < simpleClues.length - 1 ? (
                    <button
                      onClick={() => setSimpleCurrentIdx(i => i + 1)}
                      style={{
                        padding: "12px 24px", borderRadius: 14, border: "none",
                        background: "#22c55e", color: "#000",
                        fontSize: "1rem", fontWeight: 800, cursor: "pointer",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                      }}>
                      Next {isDrawOnly ? "drawing" : "act"} →
                    </button>
                  ) : (
                    <button
                      onClick={handleSimpleSubmit}
                      disabled={disabled || simpleDone}
                      style={{
                        padding: "14px 28px", borderRadius: 14, border: "none",
                        background: simpleDone ? "#6b7280" : "#22c55e", color: simpleDone ? "#fff" : "#000",
                        fontSize: "1.1rem", fontWeight: 900, cursor: simpleDone ? "default" : "pointer",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                      }}>
                      {simpleDone ? "Done! ✅" : "All done — submit ✓"}
                    </button>
                  )}
                </div>
              )}

              {/* Progress dots */}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {simpleClues.map((_, i) => (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: i === simpleCurrentIdx ? "#fff" : i < simpleCurrentIdx ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)",
                    transition: "background 0.2s",
                  }} />
                ))}
              </div>
            </div>
            );
          })() : (
            // Single clue — just show it big
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
              <div style={{
                background: "rgba(0,0,0,0.3)",
                borderRadius: 24,
                padding: "32px 40px",
                fontSize: "2.5rem",
                fontWeight: 900,
                textAlign: "center",
                maxWidth: 440,
                lineHeight: 1.3,
              }}>
                {simpleClues[0] || simplePrompt || task?.title || "Go!"}
              </div>
              <button
                onClick={handleSimpleSubmit}
                disabled={disabled || simpleDone}
                style={{
                  padding: "16px 36px", borderRadius: 16, border: "none",
                  background: simpleDone ? "#6b7280" : "#22c55e", color: simpleDone ? "#fff" : "#000",
                  fontSize: "1.2rem", fontWeight: 900, cursor: simpleDone ? "default" : "pointer",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                }}>
                {simpleDone ? "Done! ✅" : "Done — submit ✓"}
              </button>
            </div>
          )}
        </div>
      </TaskCardFrame>
    );
  }

  // ── FULL GAME MODE: draw-mime competitive team game ──
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
                <div style={{ fontSize: "0.85rem", fontWeight: 700, opacity: 0.9, letterSpacing: 1, textTransform: "uppercase" }}>
                  Round {roundIndex + 1} of {totalRounds}
                </div>
              )}
              <div style={{ fontSize: "3rem", fontWeight: 900, textShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
                DRAW OR MIME IT!
              </div>
              <div style={{ fontSize: "1.3rem", opacity: 1 }}>
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
              <TaskInstructions
                theme="dark"
                style={{ maxWidth: 380, width: "100%", textAlign: "left" }}
                steps={mode === "draw"
                  ? [
                      <>Grab <strong>paper + a pen</strong> — draw your clue on paper</>,
                      "No letters, numbers, or words",
                      "Tap the name of whoever guesses it first",
                    ]
                  : [
                      <>Act it out — <strong>no talking, no sounds</strong></>,
                      "Put the device down before you start",
                      "Tap the name of whoever guesses it first",
                    ]}
              />
              <motion.button whileTap={{ scale: 0.95 }} style={bigBtn("#22c55e")}
                onClick={() => setPhase("pass")}>
                Got it! →
              </motion.button>
              <button style={{ background: "none", border: "none", color: "rgba(255,255,255,0.85)", fontSize: "0.9rem", cursor: "pointer" }}
                onClick={() => setPhase("mode")}>← Back</button>
            </motion.div>
          )}

          {/* ── PASS TO PERFORMER ── */}
          {phase === "pass" && (
            <motion.div key="pass" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "2rem", opacity: 1 }}>📱 Hand the device to:</div>
              <div style={{ fontSize: "3.5rem", fontWeight: 900, textShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
                {performer?.name || "the performer"}
              </div>
              {mode === "draw" && (
                <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 16, padding: "14px 24px", fontSize: "1.2rem", fontWeight: 700 }}>
                  ✏️ Grab some paper and a pen first!
                </div>
              )}
              <div style={{ opacity: 0.95, fontSize: "0.95rem", marginTop: 8 }}>
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
              <div style={{ fontSize: "1.4rem", opacity: 1 }}>Hi {performer?.name || "performer"}! 👋</div>
              {!clueRevealed ? (
                <>
                  <div style={{ fontSize: "1.1rem", opacity: 0.95 }}>Make sure your team isn't peeking...</div>
                  <motion.button whileTap={{ scale: 0.95 }} style={{ ...bigBtn("#fff", "#000"), fontSize: "1.8rem" }}
                    onClick={() => setClueRevealed(true)}>
                    👁️ Reveal my clue
                  </motion.button>
                </>
              ) : (
                <>
                  <div style={{ opacity: 1, fontSize: "1rem" }}>Your clue:</div>
                  <div style={{ fontSize: "2.8rem", fontWeight: 900, background: "rgba(0,0,0,0.3)", borderRadius: 20, padding: "20px 32px", maxWidth: 480, lineHeight: 1.3 }}>
                    {prompt}
                  </div>
                  {mode === "draw" && (
                    <div style={{ opacity: 1, fontSize: "0.95rem" }}>✏️ Draw it on paper — no words or letters!</div>
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
              <div style={{ fontSize: "1.2rem", opacity: 1 }}>{mode === "draw" ? "🎨 Drawing..." : "🤫 Miming..."}</div>
              <div style={{ fontSize: "5rem", fontWeight: 900, color: timerColor, textShadow: "0 4px 20px rgba(0,0,0,0.3)", transition: "color 0.5s" }}>
                ⏱️ {timeLeft}s
              </div>
              {guessers.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ opacity: 1, fontSize: "1rem", fontWeight: 600 }}>Who guessed it?</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
                    {guessers.map(g => (
                      <motion.button whileTap={{ scale: 0.95 }} key={g.id}
                        style={{ ...bigBtn("#4ade80", "#000"), fontSize: "1.5rem", padding: "18px 32px" }}
                        onClick={() => endRound({ guessedBy: g.name, guessedBySide: g.side, reason: "guessed" })}>
                        ✅ {g.name}
                      </motion.button>
                    ))}
                  </div>
                </div>
              ) : (
                <motion.button whileTap={{ scale: 0.95 }}
                  style={{ ...bigBtn("#4ade80", "#000"), fontSize: "2rem", padding: "24px 48px", boxShadow: "0 12px 32px rgba(0,0,0,0.3)" }}
                  onClick={() => endRound({ guessedBy: "Team", guessedBySide: guessingSide, reason: "guessed" })}>
                  ✅ Guessed it!
                </motion.button>
              )}
            </motion.div>
          )}

          {/* ── TIMEOUT ── */}
          {phase === "timeout" && (
            <motion.div key="timeout" variants={pv} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 20, textAlign: "center" }}>
              <div style={{ fontSize: "4rem" }}>⏰</div>
              <div style={{ fontSize: "2.5rem", fontWeight: 900 }}>Time's Up!</div>
              <div style={{ fontSize: "1.2rem", opacity: 1 }}>Did anyone sneak in a guess?</div>
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
              <div style={{ fontSize: "1.2rem", opacity: 1, letterSpacing: 2 }}>THE CLUE WAS...</div>
              <div style={{ fontSize: "3rem", fontWeight: 900, background: "rgba(0,0,0,0.3)", borderRadius: 24, padding: "24px 40px", maxWidth: 480, lineHeight: 1.3 }}>
                {prompt}
              </div>
              {lastWinner?.name ? (
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#4ade80" }}>
                  ✅ {lastWinner.name} got it! +{1 + (lastWinner.bonus || 0)} pts
                </div>
              ) : (
                <div style={{ fontSize: "1.5rem", fontWeight: 800, opacity: 1 }}>
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
              <div style={{ opacity: 1 }}>Everyone tap your reaction — as many times as you like!</div>
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
                    <div style={{ fontSize: "0.9rem", marginTop: 4, opacity: 1 }}>{label}</div>
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
                <div style={{ fontSize: "1.4rem", opacity: 1 }}>
                  The crowd says: {topRatingEmoji} {[
                    { emoji: "🔥", label: "On fire!" }, { emoji: "😂", label: "Hilarious!" },
                    { emoji: "🤔", label: "Huh??" }, { emoji: "💀", label: "Impossible!" },
                  ].find(r => r.emoji === topRatingEmoji)?.label}
                </div>
              )}
              <div style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: "1.6rem", fontWeight: 900, background: "rgba(0,0,0,0.25)", borderRadius: 16, padding: "16px 32px" }}>
                <span>Team Score:</span>
                <span style={{ fontSize: "2rem" }}>{teamScore}</span>
              </div>
              {!isLastRound && (
                <div style={{ fontSize: "1rem", opacity: 1, marginTop: -8 }}>
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
