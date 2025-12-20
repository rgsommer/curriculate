import React, { useEffect, useMemo, useRef, useState } from "react";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// A lightweight, mobile-friendly "waiting room" mini-game.
// NOTE: This is intentionally simple and offline-first; it can optionally
// emit score updates via socket, but it doesn't require server support.
const TreasureRunnerTask = ({ task, socket, roomCode, teamId, onSubmit, disabled }) => {
  const canvasRef = useRef(null);

  const timeLimitMs = useMemo(() => {
    const raw =
      task?.timeLimitSeconds ??
      task?.config?.timeLimitSeconds ??
      task?.config?.durationSeconds ??
      60;
    const sec = Number.isFinite(Number(raw)) ? Number(raw) : 60;
    return clamp(Math.round(sec), 10, 180) * 1000;
  }, [task?.timeLimitSeconds, task?.config?.timeLimitSeconds, task?.config?.durationSeconds]);

  const [score, setScore] = useState(0);
  const [collected, setCollected] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [endedReason, setEndedReason] = useState(null); // "crash" | "time"
  const [timeLeftMs, setTimeLeftMs] = useState(timeLimitMs);

  const playerRef = useRef({
    x: 70,
    y: 240,
    width: 44,
    height: 34,
    velocityY: 0,
    jumping: false,
  });

  const obstaclesRef = useRef([]);
  const treasuresRef = useRef([]);
  const frameRef = useRef(0);
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  const lastEmitRef = useRef(0);

  const GRAVITY = 0.85;
  const JUMP_STRENGTH = -15;
  const TRACK_Y = 260;
  const GROUND_H = 26;

  const playerEmoji = task?.config?.teamEmoji || "🏎️";
  const obstacleEmoji = task?.config?.obstacleEmoji || "🪨";
  const treasureEmoji = task?.config?.treasureEmoji || "💎";

  const stopLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const endGame = (reason) => {
    if (gameOver) return;
    setEndedReason(reason || "time");
    setGameOver(true);
    stopLoop();
  };

  const handleJump = (e) => {
    if (disabled) return;
    if (gameOver) return;

    // prevent page scroll on touch
    if (e?.type === "touchstart") e.preventDefault?.();

    const p = playerRef.current;
    if (!p.jumping) {
      p.velocityY = JUMP_STRENGTH;
      p.jumping = true;
    }
  };

  // Fire a submission payload once when the game ends
  useEffect(() => {
    if (!gameOver) return;

    const finalScore = Math.max(0, Math.floor(score));
    const payload = {
      type: "treasure-runner",
      score: finalScore,
      collectibles: collected,
      endedReason: endedReason || "time",
      durationSeconds: Math.round(timeLimitMs / 1000),
      roomCode: roomCode || null,
      teamId: teamId || null,
    };

    // optional: tell peers the final score if sockets are in use elsewhere
    try {
      const s = socket?.current || socket;
      if (s?.emit) s.emit("treasure:finish", payload);
    } catch {
      // ignore
    }

    onSubmit?.(payload);
  }, [gameOver, score, collected, endedReason, timeLimitMs, onSubmit, socket, roomCode, teamId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // size: responsive but bounded
    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : window.innerWidth;
      canvas.width = clamp(w, 280, 900);
      canvas.height = 320;
    };

    resize();
    window.addEventListener("resize", resize);

    // Touch/click to jump
    canvas.addEventListener("click", handleJump);
    canvas.addEventListener("touchstart", handleJump, { passive: false });

    const reset = () => {
      const p = playerRef.current;
      p.x = 70;
      p.y = 240;
      p.width = 44;
      p.height = 34;
      p.velocityY = 0;
      p.jumping = false;

      obstaclesRef.current = [];
      treasuresRef.current = [];
      frameRef.current = 0;
      startedAtRef.current = 0;
      lastEmitRef.current = 0;

      setScore(0);
      setCollected(0);
      setTimeLeftMs(timeLimitMs);
      setGameOver(false);
      setEndedReason(null);
    };

    reset();

    let lastTime = 0;

    const loop = (time) => {
      if (gameOver || disabled) return;

      if (!startedAtRef.current) startedAtRef.current = time;
      if (!lastTime) lastTime = time;

      const dt = time - lastTime;
      lastTime = time;

      const elapsed = time - startedAtRef.current;
      const left = Math.max(0, timeLimitMs - elapsed);
      setTimeLeftMs(left);

      if (left <= 0) {
        endGame("time");
        return;
      }

      const p = playerRef.current;

      // physics
      p.velocityY += GRAVITY;
      p.y += p.velocityY;

      const groundY = TRACK_Y - p.height;
      if (p.y >= groundY) {
        p.y = groundY;
        p.jumping = false;
        p.velocityY = 0;
      }

      // spawn
      frameRef.current += 1;

      const speed = 6; // scrolling speed
      const spawnObstacleEvery = 95; // frames
      const spawnTreasureEvery = 140;

      if (frameRef.current % spawnObstacleEvery === 0) {
        obstaclesRef.current.push({
          x: canvas.width + 10,
          y: TRACK_Y - 36,
          width: 36,
          height: 36,
        });
      }
      if (frameRef.current % spawnTreasureEvery === 0) {
        treasuresRef.current.push({
          x: canvas.width + 10,
          y: TRACK_Y - 70,
          width: 28,
          height: 28,
        });
      }

      // move objects
      obstaclesRef.current = obstaclesRef.current.filter((o) => {
        o.x -= speed;
        return o.x + o.width > 0;
      });
      treasuresRef.current = treasuresRef.current.filter((t) => {
        t.x -= speed;
        return t.x + t.width > 0;
      });

      // collisions
      const playerBox = { x: p.x, y: p.y, width: p.width, height: p.height };

      for (const o of obstaclesRef.current) {
        if (rectsOverlap(playerBox, o)) {
          endGame("crash");
          break;
        }
      }

      if (!gameOver) {
        // collect
        treasuresRef.current = treasuresRef.current.filter((tr) => {
          if (rectsOverlap(playerBox, tr)) {
            setCollected((c) => c + 1);
            setScore((s) => s + 8);
            return false;
          }
          return true;
        });

        // survival score
        setScore((s) => s + dt * 0.01);
      }

      // optional: emit throttled score updates
      try {
        const s = socket?.current || socket;
        if (s?.emit) {
          const now = performance.now();
          if (now - lastEmitRef.current > 900) {
            lastEmitRef.current = now;
            s.emit("treasure:score", {
              roomCode: roomCode || null,
              teamId: teamId || null,
              score: Math.floor(score),
              collectibles: collected,
              timeLeftMs: left,
            });
          }
        }
      } catch {
        // ignore
      }

      // draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // sky
      ctx.fillStyle = "#eef2ff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // track
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(0, TRACK_Y, canvas.width, GROUND_H);

      // finish/progress bar (simple)
      ctx.fillStyle = "#1e293b";
      ctx.font = "16px Arial";
      ctx.textAlign = "left";
      ctx.fillText(
        `Bonus: ${Math.floor(score)}  •  💎 ${collected}  •  ${Math.ceil(left / 1000)}s`,
        14,
        28
      );

      // player
      ctx.font = "36px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(playerEmoji, p.x + p.width / 2, p.y + p.height / 2);

      // obstacles
      ctx.font = "30px Arial";
      for (const o of obstaclesRef.current) {
        ctx.fillText(obstacleEmoji, o.x + o.width / 2, o.y + o.height / 2);
      }

      // treasures
      ctx.font = "28px Arial";
      for (const tr of treasuresRef.current) {
        ctx.fillText(treasureEmoji, tr.x + tr.width / 2, tr.y + tr.height / 2);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    // start
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      stopLoop();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("click", handleJump);
      canvas.removeEventListener("touchstart", handleJump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLimitMs, disabled, gameOver]);

  return (
    <div style={{ textAlign: "center", padding: 14 }}>
      <h2 style={{ marginTop: 0, marginBottom: 8 }}>Treasure Runner</h2>
      <p style={{ marginTop: 0, marginBottom: 12 }}>
        Tap to jump and grab 💎 while you wait for the next task.
      </p>

      <canvas
        ref={canvasRef}
        style={{
          border: "4px solid #6366f1",
          borderRadius: 16,
          width: "100%",
          maxWidth: 900,
          touchAction: "manipulation",
        }}
      />

      {gameOver && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            {endedReason === "crash" ? "💥 Crash!" : "⏱️ Time!"} Final Bonus:{" "}
            {Math.floor(score)} (💎 {collected})
          </div>
          <div style={{ fontSize: "0.95rem", opacity: 0.8, marginTop: 6 }}>
            Waiting for the next task…
          </div>
        </div>
      )}
    </div>
  );
};

export default TreasureRunnerTask;
