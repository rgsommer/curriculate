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

  const stateRef = useRef({
    t0: performance.now(),
    last: performance.now(),
    // player
    x: 80,
    y: 120,
    vx: 140,      // forward speed
    vy: 0,
    accelHeld: false,
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
    const laneY = [85, 120, 155][Math.floor(Math.random() * 3)];
    s.obstacles.push({
      x: s.scrollX + 520 + Math.random() * 220,
      y: laneY,
      w: 26,
      h: 18,
      kind: Math.random() < 0.5 ? "rock" : "oil",
    });
  }

  function spawnTreasure(s) {
    const laneY = [85, 120, 155][Math.floor(Math.random() * 3)];
    s.treasures.push({
      x: s.scrollX + 520 + Math.random() * 260,
      y: laneY,
      r: 9,
      kind: Math.random() < 0.6 ? "boost" : "coin",
    });
  }

  function rectHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function finishAndAward(s) {
    if (s.sent) return;
    s.sent = true;

    // Points model (simple + fun):
    // - base 10 for finishing the minute
    // - +2 per collectible
    // - +5 per boost pickup
    // - -3 per hit (min 0)
    const base = 10;
    const points =
      Math.max(0, base + s.collectibles * 2 + s.boosts * 5 - s.hits * 3);

    const payload = {
      type: "treasure-runner",
      pointsEarned: points,
      collectibles: s.collectibles,
      boosts: s.boosts,
      hits: s.hits,
      durationMs: 60_000,
      finishedAt: new Date().toISOString(),
    };

    setResult(payload);
    setRunning(false);

    // Let StudentApp do optimistic update too
    try {
      onSubmit && onSubmit(payload);
    } catch {}

    // Ask server to award points (if supported)
    try {
      socket?.emit?.("score:add", {
        roomCode: me.roomCode,
        teamId: me.teamId,
        delta: points,
        reason: "TreasureRunner",
        meta: payload,
      });
      socket?.emit?.("treasure:finish", { roomCode: me.roomCode, teamId: me.teamId, ...payload });
    } catch {}
  }

  // Input (tap/hold)
  useEffect(() => {
    const onDown = () => {
      const s = stateRef.current;
      s.accelHeld = true;
    };
    const onUp = () => {
      const s = stateRef.current;
      s.accelHeld = false;
    };

    const el = canvasRef.current;
    if (!el) return;

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // Main loop
  useEffect(() => {
    if (!running) return;

    const ctx = canvasRef.current?.getContext?.("2d");
    if (!ctx) return;

    const tick = (now) => {
      const s = stateRef.current;
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;

      // Timer
      const elapsedMs = now - s.t0;
      const left = Math.max(0, 60_000 - elapsedMs);
      setTimeLeftMs(left);

      // Speed
      const accel = s.accelHeld ? 320 : -180;
      s.vx = Math.max(120, Math.min(520, s.vx + accel * dt));

      // Auto-steer / lane drift: gently oscillate
      s.y += Math.sin(now / 350) * 10 * dt;
      s.y = Math.max(72, Math.min(168, s.y));

      // Scroll
      s.scrollX += s.vx * dt;

      // Spawn
      if (s.obstacles.length < 6 && Math.random() < 0.07) spawnObstacle(s);
      if (s.treasures.length < 7 && Math.random() < 0.08) spawnTreasure(s);

      // Move world items left relative to scroll (we store in world-x)
      // Cull old
      s.obstacles = s.obstacles.filter((o) => o.x > s.scrollX - 80);
      s.treasures = s.treasures.filter((t) => t.x > s.scrollX - 80);

      // Collisions (player in world coords = scrollX + x)
      const px = s.scrollX + s.x;
      const py = s.y;
      const pw = 34, ph = 18;

      // shield decay
      if (s.shieldMs > 0) s.shieldMs = Math.max(0, s.shieldMs - dt * 1000);

      for (const o of s.obstacles) {
        if (rectHit(px, py, pw, ph, o.x, o.y, o.w, o.h)) {
          if (s.shieldMs > 0) {
            // bounce through
          } else {
            s.hits += 1;
            // slow down on hit
            s.vx = Math.max(120, s.vx * 0.65);
            // grant a short shield so we don't multi-hit in one frame
            s.shieldMs = 650;
          }
        }
      }

      for (const t of s.treasures) {
        const hit = rectHit(px, py, pw, ph, t.x - t.r, t.y - t.r, t.r * 2, t.r * 2);
        if (!hit) continue;

        if (t.kind === "coin") s.collectibles += 1;
        if (t.kind === "boost") {
          s.boosts += 1;
          s.vx = Math.min(520, s.vx + 170);
          s.shieldMs = Math.max(s.shieldMs, 900);
        }
        // remove treasure
        t.x = -1e9;
      }

      s.treasures = s.treasures.filter((t) => t.x > s.scrollX - 80);

      // Draw
      const W = 520, H = 240;
      ctx.clearRect(0, 0, W, H);

      // Track background
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, W, H);

      // Lane lines
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, 80, W, 2);
      ctx.fillRect(0, 120, W, 2);
      ctx.fillRect(0, 160, W, 2);

      // Draw obstacles/treasures in screen space
      const worldToScreen = (wx) => wx - s.scrollX;

      for (const o of s.obstacles) {
        const sx = worldToScreen(o.x);
        if (sx < -60 || sx > W + 60) continue;
        ctx.fillStyle = o.kind === "rock" ? "#6b7280" : "#111827";
        ctx.fillRect(sx, o.y, o.w, o.h);
        if (o.kind === "oil") {
          ctx.fillStyle = "rgba(59,130,246,0.35)";
          ctx.fillRect(sx + 3, o.y + 3, o.w - 6, o.h - 6);
        }
      }

      for (const t of s.treasures) {
        const sx = worldToScreen(t.x);
        if (sx < -60 || sx > W + 60) continue;
        ctx.beginPath();
        ctx.arc(sx, t.y, t.r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = t.kind === "coin" ? "#facc15" : "#22c55e";
        ctx.fill();
      }

      // Draw player
      const pScreenX = s.x;
      ctx.fillStyle = s.shieldMs > 0 ? "#60a5fa" : "#f97316";
      ctx.fillRect(pScreenX, py, pw, ph);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(pScreenX + 6, py + 4, 10, 4);

      // HUD
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "12px system-ui, -apple-system, sans-serif";
      ctx.fillText(`Time: ${Math.ceil(left / 1000)}s`, 12, 20);
      ctx.fillText(`Coins: ${s.collectibles}`, 12, 38);
      ctx.fillText(`Boosts: ${s.boosts}`, 12, 56);
      ctx.fillText(`Hits: ${s.hits}`, 12, 74);

      // End
      if (left <= 0) {
        finishAndAward(s);
        cancelAnimationFrame(rafRef.current);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [running, onSubmit, socket, me.roomCode, me.teamId]);

  const secondsLeft = Math.ceil(timeLeftMs / 1000);

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>🏁 Treasure Runner</div>
        <div style={{ fontWeight: 800, opacity: 0.85 }}>
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
          Tap/hold anywhere on the track to accelerate. Collect <strong>coins</strong> and <strong>boosts</strong>.
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
