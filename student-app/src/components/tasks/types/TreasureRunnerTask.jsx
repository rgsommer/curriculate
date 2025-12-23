// student-app/src/components/tasks/types/TreasureRunnerTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * TreasureRunnerTask (warm-up)
 * - Runs when no "real" task is assigned yet (waiting window)
 * - Awards points via socket.emit("score:add") and emits "treasure:finish"
 * - Also calls onSubmit({ type:"treasure-runner", pointsEarned, ... }) so StudentApp can update optimistically.
 */
export default function TreasureRunnerTask({
  socket,
  roomCode,
  playerTeam,
  onSubmit,
  disabled,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const [running, setRunning] = useState(true);
  const [timeLeftMs, setTimeLeftMs] = useState(60_000);
  const [result, setResult] = useState(null);

  const LANES = [85, 120, 155]; // top, middle, bottom lanes
  const stateRef = useRef({
    t0: performance.now(),
    last: performance.now(),
    // player
    x: 80,
    y: LANES[1], // start in middle lane
    targetY: LANES[1],
    currentLane: 1, // 0: top, 1: mid, 2: bottom
    vx: 140,      // forward speed (base)
    minVx: 100,   // min speed
    maxVx: 200,   // max speed
    vy: 0,
    accelHeld: false,
    decelHeld: false,
    shieldMs: 0,
    // track
    scrollX: 0,
    obstacles: [],
    treasures: [],
    // scoring
    collectibles: 0,
    hits: 0,
    boosts: 0,
    finished: false,
    sent: false,
  });

  const me = useMemo(() => {
    return {
      roomCode: String(roomCode || "").trim().toUpperCase(),
      teamId: playerTeam?.id || null,
      teamName: playerTeam?.teamName || null,
    };
  }, [roomCode, playerTeam]);

  // Simple spawners
  function spawnObstacle(s) {
    const laneIndex = Math.floor(Math.random() * 3);
    const laneY = LANES[laneIndex];
    s.obstacles.push({
      x: s.scrollX + 520 + Math.random() * 220,
      y: laneY,
      w: 26,
      h: 18,
    });
  }

  function spawnTreasure(s) {
    const laneIndex = Math.floor(Math.random() * 3);
    const laneY = LANES[laneIndex];
    s.treasures.push({
      x: s.scrollX + 520 + Math.random() * 180,
      y: laneY,
      type: Math.random() > 0.7 ? "boost" : "coin",
      w: 20,
      h: 20,
    });
  }

  // Touch controls: divide canvas into zones
  // - Left half: decelerate
  // - Right half: accelerate
  // - Top third: move up lane
  // - Bottom third: move down lane
  // (Can combine, e.g. top-left: up + slow)
  function handleTouchStart(e) {
    if (!running || disabled) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const touchX = touch.clientX - rect.left;
    const touchY = touch.clientY - rect.top;

    const s = stateRef.current;
    s.accelHeld = touchX > rect.width / 2;
    s.decelHeld = touchX <= rect.width / 2;

    // Lane change based on Y
    if (touchY < rect.height / 3 && s.currentLane > 0) {
      s.currentLane -= 1;
      s.targetY = LANES[s.currentLane];
    } else if (touchY > (2 * rect.height) / 3 && s.currentLane < 2) {
      s.currentLane += 1;
      s.targetY = LANES[s.currentLane];
    }
  }

  function handleTouchEnd(e) {
    if (!running) return;
    e.preventDefault();
    const s = stateRef.current;
    s.accelHeld = false;
    s.decelHeld = false;
  }

  // Animation loop
  function animate() {
    rafRef.current = requestAnimationFrame(animate);
    const s = stateRef.current;
    const now = performance.now();
    const dt = Math.min(now - s.last, 50) / 1000; // cap dt
    s.last = now;

    if (!running) return;

    // Speed control
    if (s.accelHeld) {
      s.vx = Math.min(s.vx + 120 * dt, s.maxVx); // accel
    } else if (s.decelHeld) {
      s.vx = Math.max(s.vx - 120 * dt, s.minVx); // decel
    } else {
      // drift back to base
      if (s.vx > 140) s.vx -= 60 * dt;
      else if (s.vx < 140) s.vx += 60 * dt;
    }

    // Lane transition (smooth y move)
    if (s.y !== s.targetY) {
      const dy = s.targetY - s.y;
      s.y += Math.sign(dy) * Math.min(Math.abs(dy), 120 * dt); // smooth move
      if (Math.abs(s.y - s.targetY) < 1) s.y = s.targetY; // snap
    }

    // Scroll + spawn
    s.scrollX += s.vx * dt;
    while (s.obstacles.length < 8 && Math.random() < 0.25) spawnObstacle(s);
    while (s.treasures.length < 5 && Math.random() < 0.18) spawnTreasure(s);

    // Collision detection
    const px = s.x;
    const py = s.y;
    const pw = 24;
    const ph = 18;

    // Treasures
    s.treasures = s.treasures.filter((t) => {
      const tx = t.x - s.scrollX;
      if (tx < -30) return false; // offscreen left

      const hit =
        tx < px + pw &&
        tx + t.w > px &&
        t.y < py + ph &&
        t.y + t.h > py;

      if (hit) {
        if (t.type === "coin") s.collectibles += 1;
        else if (t.type === "boost") {
          s.boosts += 1;
          s.vx = s.maxVx; // temp boost
        }
      }
      return !hit;
    });

    // Obstacles
    s.obstacles = s.obstacles.filter((o) => {
      const ox = o.x - s.scrollX;
      if (ox < -30) return false;

      const hit =
        ox < px + pw &&
        ox + o.w > px &&
        o.y < py + ph &&
        o.y + o.h > py;

      if (hit && s.shieldMs <= 0) {
        s.hits += 1;
        s.vx *= 0.65; // slow down on hit
        s.shieldMs = 1200; // 1.2s invuln
      }
      return true;
    });

    if (s.shieldMs > 0) s.shieldMs -= dt * 1000;

    // Draw
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, 520, 240);

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 520, 240);

    // Lanes
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    LANES.forEach((ly) => {
      ctx.beginPath();
      ctx.moveTo(0, ly + 10);
      ctx.lineTo(520, ly + 10);
      ctx.stroke();
    });

    // Obstacles
    ctx.fillStyle = "#ef4444";
    s.obstacles.forEach((o) => {
      ctx.fillRect(o.x - s.scrollX, o.y - 9, o.w, o.h);
    });

    // Treasures
    s.treasures.forEach((t) => {
      ctx.fillStyle = t.type === "coin" ? "#facc15" : "#22c55e";
      ctx.beginPath();
      ctx.arc(t.x - s.scrollX + 10, t.y, 10, 0, Math.PI * 2);
      ctx.fill();
    });

    // Player
    ctx.fillStyle = s.shieldMs > 0 ? "rgba(34,197,94,0.75)" : "#0ea5e9";
    ctx.fillRect(s.x, s.y - 9, pw, ph);

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui";
    ctx.fillText(`Coins: ${s.collectibles}  Boosts: ${s.boosts}  Hits: ${s.hits}`, 12, 28);
  }

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchmove", handleTouchStart); // allow dragging
    canvas.addEventListener("touchend", handleTouchEnd);

    rafRef.current = requestAnimationFrame(animate);

    const timer = setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev <= 1000) {
          setRunning(false);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchStart);
      canvas.removeEventListener("touchend", handleTouchEnd);
      clearInterval(timer);
    };
  }, [running, disabled]);

  useEffect(() => {
    if (timeLeftMs <= 0 && running && !result) {
      setRunning(false);
      const s = stateRef.current;
      const points = Math.floor(s.collectibles * 5 + s.boosts * 10 - s.hits * 3);
      const finalPoints = Math.max(0, points);
      setResult({
        pointsEarned: finalPoints,
        collectibles: s.collectibles,
        boosts: s.boosts,
        hits: s.hits,
      });
      if (onSubmit && typeof onSubmit === "function") {
        onSubmit({
          type: "treasure-runner",
          pointsEarned: finalPoints,
          collectibles: s.collectibles,
          boosts: s.boosts,
          hits: s.hits,
        });
      }
      if (socket && me.roomCode && me.teamId && !s.sent) {
        s.sent = true;
        socket.emit("score:add", {
          roomCode: me.roomCode,
          teamId: me.teamId,
          delta: finalPoints,
          reason: "TreasureRunner",
          meta: { collectibles: s.collectibles, boosts: s.boosts, hits: s.hits },
        });
        socket.emit("treasure:finish", {
          roomCode: me.roomCode,
          teamId: me.teamId,
          pointsEarned: finalPoints,
          collectibles: s.collectibles,
          boosts: s.boosts,
          hits: s.hits,
        });
      }
    }
  }, [timeLeftMs, running, result, socket, onSubmit, me]);

  const secondsLeft = Math.ceil(timeLeftMs / 1000);

  return (
    <div style={{ opacity: disabled ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>Treasure Runner</div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>
          {result ? "Finished!" : `Time left: ${secondsLeft}s`}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <canvas
          ref={canvasRef}
          width={520}
          height={240}
          style={{
            width: "100%",
            maxWidth: 720,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(15,23,42,0.75)",
            touchAction: "none",
            opacity: disabled ? 0.7 : 1,
          }}
        />
      </div>

      {!result ? (
        <div style={{ marginTop: 10, opacity: 0.9 }}>
          Tap left to slow down, right to speed up. Tap top/bottom to move up/down lanes. Collect <strong>coins</strong> and <strong>boosts</strong>.
          Avoid obstacles. Points get awarded when the timer hits 0.
        </div>
      ) : (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 14,
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.2)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: "1rem" }}>
            +{result.pointsEarned} points!
          </div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            Coins: <strong>{result.collectibles}</strong> • Boosts:{" "}
            <strong>{result.boosts}</strong> • Hits: <strong>{result.hits}</strong>
          </div>
          <div style={{ marginTop: 10, opacity: 0.85 }}>
            Waiting for the first real task…
          </div>
        </div>
      )}
    </div>
  );
}