// student-app/src/components/tasks/types/HoleInOneTask.jsx
//
// Hole in One MVP (HOLE_IN_ONE_PLAN.md).
//
// For the MVP we collapse the spec's three-phase loop (Earn → Build → Tilt)
// into one screen: rails are PRE-PLACED from `config.board.obstacles`, and
// the team tilts the device to roll the ball into the hole. Earn + Build
// phases are deferred to v2 — they need a longer build cycle than this MVP
// is willing to spend.
//
// Physics: simple Euler integration. Tilt → acceleration. Friction each tick.
// AABB collision with walls + rails. Circle/circle vs hole. Out-of-bounds → reset.
import React, { useEffect, useMemo, useRef, useState } from "react";
import useDeviceTilt from "../../../hooks/useDeviceTilt.js";

const BOARD_DEFAULT = {
  width: 12,
  height: 18,
  gridSize: 24,            // px per grid unit
  startPosition: { x: 1, y: 1 },
  holePosition: { x: 10, y: 16, radius: 0.8 },
  obstacles: [],            // [{ type, x, y, w, h }]
};

const PHYSICS_DEFAULT = {
  gravity:    0.35,
  friction:   0.95,
  bounciness: 0.55,
  ballRadius: 0.45,
};

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default function HoleInOneTask({ task, onSubmit, disabled }) {
  const cfg = task?.config || {};
  const board = { ...BOARD_DEFAULT, ...(cfg.board || {}) };
  const phys = { ...PHYSICS_DEFAULT, ...(cfg.physics || {}) };
  const successPoints = Number(cfg?.scoring?.successPoints ?? 10);
  const playPoints = Number(cfg?.scoring?.playPoints ?? 1);

  // v2: Earn phase — question bank pre-tilt. Correct answers award coins.
  // The bank lives at config.questionBank: [{ id, prompt, correctAnswer, reward }]
  const questionBank = Array.isArray(cfg.questionBank) ? cfg.questionBank : [];
  const tilterMode = cfg?.tilter?.mode || "rotation";  // "rotation" | "free-choice" | "random"
  const teamMembers = Array.isArray(cfg?.teamMembers) ? cfg.teamMembers : [];

  // Phase state: "earn" → "build" → "tilter-pick" → "tilt"
  // Skip earn if no question bank; skip build if no purchasable items; skip tilter-pick if only 1 known member.
  const economy = cfg.economy || {};
  const railCosts = {
    "straight": Number(economy.straightRailCost ?? 3),
    "curved":   Number(economy.curvedRailCost ?? 5),
    "bumper":   Number(economy.bumperCost ?? 4),
  };
  const skipBuildPhase = !Number.isFinite(railCosts.straight) || railCosts.straight <= 0;

  const initialPhase = questionBank.length > 0 ? "earn"
    : !skipBuildPhase ? "build"
    : (teamMembers.length > 1 ? "tilter-pick" : "tilt");

  const [phase, setPhase] = useState(initialPhase);
  const [coins, setCoins] = useState(Number(cfg?.resources?.startingCoins) || 0);
  const [answeredIds, setAnsweredIds] = useState({});  // id → boolean correct
  const [currentTilter, setCurrentTilter] = useState(null);
  const [tilterHistory, setTilterHistory] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [studentAnswer, setStudentAnswer] = useState("");

  // Build-phase state: extra obstacles placed by the team (added to board.obstacles for physics)
  const [placedObstacles, setPlacedObstacles] = useState([]);
  const [selectedRailType, setSelectedRailType] = useState("straight");

  const { tilt, sourceLabel, permissionState, requestPermission, virtualJoystick } = useDeviceTilt({
    sensitivity: Number(cfg?.controls?.sensitivity) || 1,
    smoothing:   Number(cfg?.controls?.smoothing)   || 0.85,
  });

  const ballRef = useRef({
    x: board.startPosition.x + 0.5,
    y: board.startPosition.y + 0.5,
    vx: 0, vy: 0,
  });
  const [tick, setTick] = useState(0);                // forces re-renders
  const [status, setStatus] = useState("playing");    // "playing" | "success" | "failed"
  const [attempts, setAttempts] = useState(0);

  // Pick next tilter: rotation prefers players who have NOT yet tilted
  const nextTilterCandidates = (() => {
    if (teamMembers.length === 0) return [];
    if (tilterMode === "rotation") {
      const tilted = new Set(tilterHistory);
      const untilted = teamMembers.filter((m) => !tilted.has(m));
      return untilted.length > 0 ? untilted : teamMembers;
    }
    return teamMembers;
  })();

  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  // Physics step — only runs in "tilt" phase
  useEffect(() => {
    if (phase !== "tilt") return undefined;
    let cancelled = false;
    const step = () => {
      const b = ballRef.current;
      if (status === "playing" && !disabled) {
        // Tilt → acceleration
        b.vx += tilt.x * phys.gravity * 0.15;
        b.vy += tilt.y * phys.gravity * 0.15;
        // Friction
        b.vx *= phys.friction;
        b.vy *= phys.friction;
        // Velocity cap to keep things sane
        b.vx = _clamp(b.vx, -0.5, 0.5);
        b.vy = _clamp(b.vy, -0.5, 0.5);
        // Integrate
        b.x += b.vx;
        b.y += b.vy;

        // Wall collisions (clamp + reflect with bounciness)
        const r = phys.ballRadius;
        if (b.x < r)              { b.x = r;              b.vx = -b.vx * phys.bounciness; }
        if (b.x > board.width - r){ b.x = board.width - r;b.vx = -b.vx * phys.bounciness; }
        if (b.y < r)              { b.y = r;              b.vy = -b.vy * phys.bounciness; }
        if (b.y > board.height - r){b.y = board.height - r;b.vy = -b.vy * phys.bounciness; }

        // AABB obstacle collisions — simple swept resolve.
        // Combine static board obstacles with build-phase placements.
        const allObstacles = [...(board.obstacles || []), ...placedObstacles];
        for (const o of allObstacles) {
          if (!o || o.type === "gap") continue;
          const ox = Number(o.x) || 0, oy = Number(o.y) || 0;
          const ow = Number(o.w) || 1, oh = Number(o.h) || 1;
          const closestX = _clamp(b.x, ox, ox + ow);
          const closestY = _clamp(b.y, oy, oy + oh);
          const dx = b.x - closestX, dy = b.y - closestY;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < r * r) {
            const dist = Math.sqrt(dist2) || 0.0001;
            const nx = dx / dist, ny = dy / dist;
            // Push out
            const overlap = r - dist;
            b.x += nx * overlap;
            b.y += ny * overlap;
            // Reflect velocity along normal
            const dot = b.vx * nx + b.vy * ny;
            b.vx = (b.vx - 2 * dot * nx) * phys.bounciness;
            b.vy = (b.vy - 2 * dot * ny) * phys.bounciness;
          }
        }

        // Hole detection
        const dx = b.x - (board.holePosition.x + 0.5);
        const dy = b.y - (board.holePosition.y + 0.5);
        if (Math.sqrt(dx * dx + dy * dy) < (Number(board.holePosition.radius) || 0.8)) {
          setStatus("success");
          setAttempts((a) => a + 1);
        }
      }
      if (!cancelled) {
        setTick((t) => (t + 1) % 1e9);
        rafRef.current = window.requestAnimationFrame(step);
      }
    };
    rafRef.current = window.requestAnimationFrame(step);
    return () => { cancelled = true; window.cancelAnimationFrame(rafRef.current); };
  }, [tilt, status, disabled, board, phys, phase, placedObstacles]);

  /* ──────── Build-phase handlers ──────── */
  const railShape = {
    "straight": { w: 3, h: 0.4 },
    "curved":   { w: 2, h: 2 },
    "bumper":   { w: 1, h: 1 },
  };
  const handlePlaceRail = (gx, gy) => {
    const cost = railCosts[selectedRailType] || 0;
    if (coins < cost) return;
    const shape = railShape[selectedRailType];
    const newObs = {
      type: selectedRailType === "bumper" ? "wall" : "wall",  // physics treats all as walls for MVP
      x: gx, y: gy, w: shape.w, h: shape.h, kind: selectedRailType,
    };
    setPlacedObstacles((cur) => [...cur, newObs]);
    setCoins((c) => c - cost);
  };
  const finishBuilding = () => setPhase(teamMembers.length > 1 ? "tilter-pick" : "tilt");

  /* ──────── Earn-phase handlers ──────── */
  const currentQ = questionBank[currentQuestion] || null;
  const handleAnswerQuestion = () => {
    if (!currentQ) return;
    const submitted = studentAnswer.trim().toLowerCase();
    const expected = String(currentQ.correctAnswer || "").trim().toLowerCase();
    const correct = submitted === expected || (expected.length > 3 && submitted.includes(expected));
    setAnsweredIds((cur) => ({ ...cur, [currentQ.id || currentQuestion]: correct }));
    if (correct) {
      const reward = currentQ.reward || { coins: 5 };
      if (Number(reward.coins) > 0) setCoins((c) => c + Number(reward.coins));
    }
    setStudentAnswer("");
    if (currentQuestion + 1 < questionBank.length) {
      setCurrentQuestion((q) => q + 1);
    } else {
      // Earn phase done; advance to build (if purchasable items) or tilter / tilt
      setPhase(!skipBuildPhase ? "build" : teamMembers.length > 1 ? "tilter-pick" : "tilt");
    }
  };
  const skipEarnPhase = () => setPhase(!skipBuildPhase ? "build" : teamMembers.length > 1 ? "tilter-pick" : "tilt");

  /* ──────── Tilter-pick handlers ──────── */
  const handlePickTilter = (name) => {
    setCurrentTilter(name);
    setTilterHistory((h) => [...h, name]);
    setPhase("tilt");
  };

  const handleReset = () => {
    const b = ballRef.current;
    b.x = board.startPosition.x + 0.5;
    b.y = board.startPosition.y + 0.5;
    b.vx = 0; b.vy = 0;
    setStatus("playing");
    setAttempts((a) => a + 1);
  };

  const handleContinue = () => {
    if (onSubmit) {
      onSubmit({
        type: "hole-in-one",
        success: status === "success",
        attempts,
        pointsEarned: status === "success" ? successPoints : playPoints,
        autoComplete: true,
      });
    }
  };

  // Permission gate (iOS Safari)
  const needsPrompt = permissionState === "needs-prompt";
  const unsupported = permissionState === "unsupported";

  /* ──────────────── Phase-gated Render ──────────────── */
  // ── Earn phase: answer questions to earn coins ──
  if (phase === "earn") {
    return (
      <div style={wrap}>
        <div style={tagStrip}>Hole in One · Earn supplies</div>
        <div style={titleStyle}>Earn coins to build your course</div>
        <div style={statusLine}>Coins: 🪙 {coins} · Question {currentQuestion + 1} of {questionBank.length}</div>
        {currentQ && (
          <div style={{ padding: 14, background: "rgba(30,41,59,0.55)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 12 }}>
            <div style={{ fontSize: "1rem", color: "#f1f5f9", marginBottom: 10 }}>{currentQ.prompt}</div>
            {Array.isArray(currentQ.options) && currentQ.options.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {currentQ.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setStudentAnswer(opt); }}
                    style={{
                      padding: "8px 12px", borderRadius: 8,
                      background: studentAnswer === opt ? "rgba(124,58,237,0.25)" : "rgba(15,23,42,0.5)",
                      border: studentAnswer === opt ? "1px solid #7c3aed" : "1px solid #334155",
                      color: "#e2e8f0", textAlign: "left", cursor: "pointer", fontSize: "0.9rem",
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={studentAnswer}
                onChange={(e) => setStudentAnswer(e.target.value)}
                placeholder="Your answer…"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #475569", background: "rgba(15,23,42,0.6)", color: "#f1f5f9", fontSize: "0.95rem" }}
              />
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button type="button" onClick={skipEarnPhase} style={giveUpBtn}>Skip earning → tilt</button>
          <button type="button" onClick={handleAnswerQuestion} disabled={!studentAnswer.trim()} style={{ ...resetBtn, opacity: studentAnswer.trim() ? 1 : 0.5 }}>
            Submit answer
          </button>
        </div>
      </div>
    );
  }

  // ── Build phase: place rails on the grid (spends coins) ──
  if (phase === "build") {
    const buildCanvasW = board.width * board.gridSize;
    const buildCanvasH = board.height * board.gridSize;
    const handleGridClick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / board.gridSize);
      const gy = Math.floor((e.clientY - rect.top) / board.gridSize);
      handlePlaceRail(gx, gy);
    };
    return (
      <div style={wrap}>
        <div style={tagStrip}>Hole in One · Build the course</div>
        <div style={titleStyle}>Place rails to guide the ball</div>
        <div style={statusLine}>Coins: 🪙 {coins} · Placed: {placedObstacles.length}</div>

        {/* Rail type picker */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(railCosts).map(([type, cost]) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedRailType(type)}
              disabled={coins < cost}
              style={{
                padding: "6px 12px", borderRadius: 8,
                background: selectedRailType === type ? "rgba(124,58,237,0.25)" : "rgba(15,23,42,0.5)",
                border: selectedRailType === type ? "1px solid #7c3aed" : "1px solid #334155",
                color: coins < cost ? "#475569" : "#e2e8f0",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: coins < cost ? "not-allowed" : "pointer",
              }}
            >
              {type} · 🪙 {cost}
            </button>
          ))}
        </div>

        {/* Board with placement overlay */}
        <div style={{ position: "relative", width: buildCanvasW, height: buildCanvasH, alignSelf: "center" }}>
          <svg
            width={buildCanvasW}
            height={buildCanvasH}
            onClick={handleGridClick}
            style={{ background: "#0f172a", border: "2px solid #475569", borderRadius: 10, cursor: "crosshair" }}
          >
            {/* Grid */}
            {Array.from({ length: board.width + 1 }, (_, i) => (
              <line key={`gx-${i}`} x1={i * board.gridSize} y1={0} x2={i * board.gridSize} y2={buildCanvasH} stroke="#1e293b" strokeWidth={1} />
            ))}
            {Array.from({ length: board.height + 1 }, (_, i) => (
              <line key={`gy-${i}`} x1={0} y1={i * board.gridSize} x2={buildCanvasW} y2={i * board.gridSize} stroke="#1e293b" strokeWidth={1} />
            ))}
            {/* Static board obstacles */}
            {(board.obstacles || []).map((o, i) => (
              <rect key={`s${i}`}
                x={(Number(o.x) || 0) * board.gridSize}
                y={(Number(o.y) || 0) * board.gridSize}
                width={(Number(o.w) || 1) * board.gridSize}
                height={(Number(o.h) || 1) * board.gridSize}
                fill={o.type === "gap" ? "#7f1d1d" : "#7c3aed"} opacity={0.75} rx={4}
              />
            ))}
            {/* Placed obstacles */}
            {placedObstacles.map((o, i) => (
              <rect key={`p${i}`}
                x={o.x * board.gridSize}
                y={o.y * board.gridSize}
                width={o.w * board.gridSize}
                height={o.h * board.gridSize}
                fill="#22c55e" opacity={0.6} rx={4}
              />
            ))}
            {/* Hole */}
            <circle
              cx={(board.holePosition.x + 0.5) * board.gridSize}
              cy={(board.holePosition.y + 0.5) * board.gridSize}
              r={(Number(board.holePosition.radius) || 0.8) * board.gridSize}
              fill="#22c55e" opacity={0.6}
            />
            {/* Ball start indicator */}
            <circle
              cx={(board.startPosition.x + 0.5) * board.gridSize}
              cy={(board.startPosition.y + 0.5) * board.gridSize}
              r={phys.ballRadius * board.gridSize}
              fill="#f59e0b" opacity={0.5}
            />
          </svg>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => setPlacedObstacles([])}
            disabled={placedObstacles.length === 0}
            style={resetBtn}
          >
            Clear rails
          </button>
          <button type="button" onClick={finishBuilding} style={{ ...resetBtn, background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" }}>
            Done → Tilt
          </button>
        </div>
      </div>
    );
  }

  // ── Tilter-pick phase ──
  if (phase === "tilter-pick") {
    return (
      <div style={wrap}>
        <div style={tagStrip}>Hole in One · Choose tilter</div>
        <div style={titleStyle}>Who's tilting this turn?</div>
        <div style={statusLine}>Coins earned: 🪙 {coins} · Past tilters: {tilterHistory.length === 0 ? "(none yet)" : tilterHistory.join(", ")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {nextTilterCandidates.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handlePickTilter(name)}
              style={{
                padding: "10px 14px", borderRadius: 10,
                background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.4)",
                color: "#fde68a", fontWeight: 600, cursor: "pointer", textAlign: "left",
              }}
            >
              🎮 {name}
              {tilterHistory.includes(name) ? (
                <span style={{ marginLeft: 8, fontSize: "0.72rem", color: "#94a3b8" }}>(tilted before)</span>
              ) : (
                <span style={{ marginLeft: 8, fontSize: "0.72rem", color: "#22c55e" }}>· hasn't tilted yet</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Tilt phase: the actual physics game ──
  const canvasW = board.width * board.gridSize;
  const canvasH = board.height * board.gridSize;

  return (
    <div style={wrap}>
      <div style={tagStrip}>Hole in One</div>
      <div style={titleStyle}>{task?.title || "Roll It Home"}</div>
      <div style={statusLine}>
        {currentTilter ? <>Tilter: <strong style={{ color: "#fde68a" }}>{currentTilter}</strong> · </> : null}
        🪙 {coins} · Source: {sourceLabel} · attempts: {attempts}
      </div>

      {needsPrompt && (
        <button type="button" onClick={requestPermission} style={permissionBtn}>
          Enable tilt controls
        </button>
      )}
      {unsupported && (
        <div style={{ fontSize: "0.85rem", color: "#fde68a" }}>
          This device doesn't have tilt sensors — use arrow keys (WASD) or the on-screen joystick below.
        </div>
      )}

      <div style={{ position: "relative", width: canvasW, height: canvasH, alignSelf: "center" }}>
        <svg
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          style={{ background: "#0f172a", border: "2px solid #475569", borderRadius: 10, display: "block" }}
        >
          {/* Grid lines */}
          {Array.from({ length: board.width + 1 }, (_, i) => (
            <line key={`gx-${i}`} x1={i * board.gridSize} y1={0} x2={i * board.gridSize} y2={canvasH} stroke="#1e293b" strokeWidth={1} />
          ))}
          {Array.from({ length: board.height + 1 }, (_, i) => (
            <line key={`gy-${i}`} x1={0} y1={i * board.gridSize} x2={canvasW} y2={i * board.gridSize} stroke="#1e293b" strokeWidth={1} />
          ))}

          {/* Obstacles */}
          {(board.obstacles || []).map((o, i) => (
            <rect
              key={i}
              x={(Number(o.x) || 0) * board.gridSize}
              y={(Number(o.y) || 0) * board.gridSize}
              width={(Number(o.w) || 1) * board.gridSize}
              height={(Number(o.h) || 1) * board.gridSize}
              fill={o.type === "gap" ? "#7f1d1d" : o.type === "trap" ? "#dc2626" : "#7c3aed"}
              opacity={o.type === "gap" ? 0.4 : 0.85}
              rx={6}
            />
          ))}

          {/* Hole */}
          <circle
            cx={(board.holePosition.x + 0.5) * board.gridSize}
            cy={(board.holePosition.y + 0.5) * board.gridSize}
            r={(Number(board.holePosition.radius) || 0.8) * board.gridSize}
            fill="#22c55e"
            opacity={0.7}
          />

          {/* Ball */}
          <circle
            cx={ballRef.current.x * board.gridSize}
            cy={ballRef.current.y * board.gridSize}
            r={phys.ballRadius * board.gridSize}
            fill="#f59e0b"
            stroke="#fef3c7"
            strokeWidth={2}
          />
        </svg>

        {/* Success overlay */}
        {status === "success" && (
          <div style={successOverlay}>
            <div style={{ fontSize: "2.5rem" }}>🏌️‍♂️</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#22c55e" }}>+{successPoints} pts!</div>
            <button type="button" onClick={handleContinue} disabled={disabled} style={continueBtn}>
              Continue →
            </button>
          </div>
        )}
      </div>

      {/* Virtual joystick (only when not using orientation). Pointer events →
          works with a laptop MOUSE as well as touch. Keyboard (WASD / arrows)
          also works anytime. */}
      {sourceLabel !== "orientation" && (
        <>
          <div
            style={{ ...joystickWrap, touchAction: "none", cursor: "grab" }}
            onPointerDown={virtualJoystick.onPointerDown}
            onPointerMove={virtualJoystick.onPointerMove}
            onPointerUp={virtualJoystick.onPointerUp}
            onPointerCancel={virtualJoystick.onPointerCancel}
            onTouchStart={virtualJoystick.onTouchStart}
            onTouchMove={virtualJoystick.onTouchMove}
            onTouchEnd={virtualJoystick.onTouchEnd}
          >
            <div style={joystickPad}>
              <span style={{ fontSize: "0.65rem", color: "#94a3b8" }}>drag (or use WASD / arrow keys)</span>
            </div>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#94a3b8", textAlign: "center", marginTop: 2 }}>
            On a laptop: drag the pad with your mouse, or steer with <strong>WASD</strong> / arrow keys.
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" onClick={handleReset} disabled={disabled} style={resetBtn}>
          Reset
        </button>
        <button type="button" onClick={handleContinue} disabled={disabled} style={giveUpBtn}>
          {status === "success" ? "Continue →" : "Skip"}
        </button>
      </div>
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "14px 14px",
  alignItems: "stretch",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};
const tagStrip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#fbbf24",
  padding: "2px 8px",
  background: "rgba(251,191,36,0.18)",
  borderRadius: 999,
  alignSelf: "flex-start",
};
const titleStyle = { fontSize: "1.4rem", fontWeight: 800, color: "#f1f5f9" };
const statusLine = { fontSize: "0.7rem", color: "#94a3b8" };
const permissionBtn = {
  padding: "10px 18px",
  fontSize: "0.9rem",
  fontWeight: 700,
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  alignSelf: "center",
};
const successOverlay = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  background: "rgba(15,23,42,0.85)",
  borderRadius: 10,
};
const continueBtn = {
  padding: "10px 24px",
  fontSize: "0.95rem",
  fontWeight: 700,
  background: "linear-gradient(135deg, #22c55e, #16a34a)",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
};
const joystickWrap = {
  alignSelf: "center",
  marginTop: 4,
  touchAction: "none",
  userSelect: "none",
};
const joystickPad = {
  width: 100,
  height: 100,
  borderRadius: "50%",
  background: "rgba(124,58,237,0.18)",
  border: "1px solid rgba(124,58,237,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const resetBtn = {
  padding: "8px 18px",
  fontSize: "0.85rem",
  fontWeight: 700,
  background: "transparent",
  border: "1px solid #7c3aed",
  borderRadius: 10,
  color: "#c4b5fd",
  cursor: "pointer",
};
const giveUpBtn = {
  padding: "8px 18px",
  fontSize: "0.85rem",
  fontWeight: 700,
  background: "#475569",
  border: "none",
  borderRadius: 10,
  color: "#f1f5f9",
  cursor: "pointer",
};
