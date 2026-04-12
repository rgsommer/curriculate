// student-app/src/components/tasks/types/TreasureRunnerTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// Local sound paths (in /public/sounds/)
const SOUNDS = {
  coin: "/sounds/coin.mp3",
  boost: "/sounds/boost.mp3",
  hit: "/sounds/hit.mp3",
  nearMiss: "/sounds/nearMiss.mp3",
  lane: "/sounds/lane.mp3",
};

const BG_MUSIC_SRC = "/sounds/TreasureRunnerIntro.mp3";

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
  const [permission, setPermission] = useState("prompt");
  const [currentScore, setCurrentScore] = useState(0);

  // Keep score in a ref so the animation loop always sees the latest value.
  const scoreRef = useRef(0);

  // Touch gesture tuning (tap-to-jump + swipe-down-to-drop)
  const TAP_SLOP_PX = 12;        // max movement for a tap
  const TAP_MAX_MS = 250;        // tap must be quick
  const SWIPE_DOWN_PX = 28;      // downward swipe distance
  const SWIPE_TIME_MS = 220;     // downward swipe must be quick
  const FAST_FALL_VY = 22;       // downward velocity to force (tune as needed)

  const bumpScore = (fn) => {
    // fn: (prev:number) => next:number
    const next = Number(fn(scoreRef.current)) || 0;
    scoreRef.current = Math.max(0, next);
    setCurrentScore(scoreRef.current); // keep React state for overlays/UI
  };

  const doJump = () => {
    if (!running || disabled) return;
    const s = stateRef.current;
    if (s.isJumping) return; // no double jumps
    s.isJumping = true;
    s.jumpVelocity = -12; // upward impulse
    vibrate(40);
    playSound("lane", 0.7);
  };

  const fastFall = () => {
    if (!running || disabled) return;
    const s = stateRef.current;
    if (!s.isJumping) return; // only mid-air
    // Force a strong downward velocity (positive is down in this coordinate system)
    s.jumpVelocity = Math.max(s.jumpVelocity, FAST_FALL_VY);
  };


  const LANES = [85, 120, 155];
  const stateRef = useRef({
    t0: performance.now(),
    last: performance.now(),
    x: 80,
    y: LANES[1],
    targetY: LANES[1],
    currentLane: 1,
    vx: 140,
    minVx: 80,
    maxVx: 240,
    shieldMs: 0,
    beta: 0,
    gamma: 0,
    lastLaneChangeTime: 0,
    lastNearMissTime: 0,
    jumpVelocity: 0,
    isJumping: false,
    touchId: null,
    startX: 0,
    startY: 0,
    dragX: 0,
    dragY: 0,
    scrollX: 0,
    obstacles: [],
    treasures: [],
    collectibles: 0,
    hits: 0,
    boosts: 0,
    finished: false,
    sent: false,
  });


  // ------------------------------------------------------------
  // Spawners (were missing in the earlier drop-in)
  // ------------------------------------------------------------
  const randLaneY = () => LANES[Math.floor(Math.random() * LANES.length)];

  const nextSpawnX = (arr, baseX, minGap) => {
    const maxX = arr.reduce((mx, it) => Math.max(mx, it.x || 0), baseX);
    return maxX + minGap + Math.random() * (minGap * 0.8);
  };

  function spawnObstacle(s) {
    const baseX = s.scrollX + 520;
    const x = nextSpawnX(s.obstacles, baseX, 90);
    const y = randLaneY();
    s.obstacles.push({ x, y, w: 22, h: 18 });
  }

  function spawnTreasure(s) {
    const baseX = s.scrollX + 520;
    const x = nextSpawnX(s.treasures, baseX, 110);
    const y = randLaneY();
    const type = Math.random() < 0.18 ? "boost" : "coin";
    s.treasures.push({ x, y, w: 20, h: 20, type });
  }


  const me = useMemo(() => ({
    roomCode: String(roomCode || "").trim().toUpperCase(),
    teamId: playerTeam?.id || null,
    teamName: playerTeam?.teamName || null,
  }), [roomCode, playerTeam]);

  // Preload sounds from public folder
  const soundRefs = useRef({});
  useEffect(() => {
    Object.keys(SOUNDS).forEach((key) => {
      const audio = new Audio(SOUNDS[key]);
      audio.preload = "auto";
      soundRefs.current[key] = audio;
    });
  }, []);

  // ── Background music: loops while the game is running, fades out on finish ──
  const bgMusicRef = useRef(null);
  const bgFadeRef = useRef(null);

  useEffect(() => {
    const audio = new Audio(BG_MUSIC_SRC);
    audio.loop = true;
    audio.volume = 0.35;
    audio.preload = "auto";
    bgMusicRef.current = audio;
    return () => {
      // Cleanup on unmount
      if (bgFadeRef.current) clearInterval(bgFadeRef.current);
      try { audio.pause(); } catch {}
      bgMusicRef.current = null;
    };
  }, []);

  // Start music when permission is granted (first interaction)
  useEffect(() => {
    const audio = bgMusicRef.current;
    if (!audio) return;
    if (permission === "granted" && running && !result) {
      audio.volume = 0.35;
      audio.play().catch(() => {});
    }
  }, [permission, running, result]);

  // Fade out when game ends
  useEffect(() => {
    const audio = bgMusicRef.current;
    if (!audio) return;
    if (!running || result) {
      // Fade out over ~1.5s
      if (bgFadeRef.current) clearInterval(bgFadeRef.current);
      bgFadeRef.current = setInterval(() => {
        if (audio.volume > 0.02) {
          audio.volume = Math.max(0, audio.volume - 0.03);
        } else {
          clearInterval(bgFadeRef.current);
          bgFadeRef.current = null;
          try { audio.pause(); } catch {}
          audio.volume = 0.35;
        }
      }, 50);
    }
  }, [running, result]);

  const playSound = (key, volume = 0.6) => {
    const sound = soundRefs.current[key];
    if (sound) {
      sound.currentTime = 0;
      sound.volume = volume;
      sound.play().catch(() => {});
    }
  };

  const vibrate = (pattern = 50) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  };

  const requestPermission = async () => {
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        setPermission(response);
      } catch {
        setPermission("denied");
      }
    } else {
      setPermission("granted");
    }
  };

  // Tap to jump (used by gesture logic)
  const handleTapJump = (e) => {
    // Backwards-compatible wrapper
    if (e?.preventDefault) e.preventDefault();
    doJump();
  };

  // Touch drag (for speed + lane)
  const handleTouchStart = (e) => {
    if (!running || disabled) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const s = stateRef.current;
    s.touchId = touch.identifier;
    s.startX = touch.clientX - rect.left;
    s.startY = touch.clientY - rect.top;
    s.dragX = 0;
    s.dragY = 0;

    // Gesture tracking
    s.tapStartX = touch.clientX;
    s.tapStartY = touch.clientY;
    s.tapStartT = Date.now();
    s.tapMoved = false;
};

  const handleTouchMove = (e) => {
    if (!running || disabled) return;
    e.preventDefault();
    const s = stateRef.current;
    if (s.touchId === null) return;

    const touch = Array.from(e.touches).find(t => t.identifier === s.touchId);
    if (!touch) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const currentX = touch.clientX - rect.left;
    const currentY = touch.clientY - rect.top;

    s.dragX = currentX - s.startX;
    s.dragY = currentY - s.startY;

    // Mark as moved if this isn't a tap
    const dxClient = touch.clientX - (s.tapStartX ?? touch.clientX);
    const dyClient = touch.clientY - (s.tapStartY ?? touch.clientY);
    if (Math.abs(dxClient) > TAP_SLOP_PX || Math.abs(dyClient) > TAP_SLOP_PX) {
      s.tapMoved = true;
    }

    // Quick swipe-down while mid-air => fast fall
    const dtMs = Date.now() - (s.tapStartT ?? Date.now());
    if (!disabled && running && s.isJumping && dyClient >= SWIPE_DOWN_PX && dtMs <= SWIPE_TIME_MS) {
      fastFall();
      // prevent repeated triggers during same touch
      s.tapStartT = 0;
    }

    // Speed from horizontal drag
    const dragStrength = s.dragX / 100;
    if (dragStrength > 0.2) {
      s.vx = Math.min(s.vx + dragStrength * 200 * 0.016, s.maxVx);
    } else if (dragStrength < -0.2) {
      s.vx = Math.max(s.vx + dragStrength * 200 * 0.016, s.minVx);
    }

    // Lane change from vertical drag
    if (Math.abs(s.dragY) > 60) {
      if (s.dragY < -60 && s.currentLane > 0) {
        s.currentLane -= 1;
        s.targetY = LANES[s.currentLane];
        vibrate(30);
        playSound("lane", 0.5);
      } else if (s.dragY > 60 && s.currentLane < 2) {
        s.currentLane += 1;
        s.targetY = LANES[s.currentLane];
        vibrate(30);
        playSound("lane", 0.5);
      }
      s.dragY = 0;
    }
  };

  const handleTouchEnd = (e) => {
    const s = stateRef.current;

    // If this touch was a quick tap (no significant move), treat as jump.
    const dtMs = Date.now() - (s.tapStartT ?? Date.now());
    if (!disabled && running && !s.tapMoved && dtMs <= TAP_MAX_MS) {
      doJump();
    }

    s.touchId = null;
    s.dragX = 0;
    s.dragY = 0;
    s.tapMoved = false;
  };

  // Tilt controls
  const handleOrientation = (event) => {
    if (!running || disabled) return;
    const s = stateRef.current;
    const now = performance.now();

    const gamma = event.gamma || 0;
    const beta = event.beta || 0;

    if (beta < 20 && s.currentLane > 0 && now - s.lastLaneChangeTime > 800) {
      s.currentLane -= 1;
      s.targetY = LANES[s.currentLane];
      s.lastLaneChangeTime = now;
      vibrate(30);
      playSound("lane", 0.5);
    } else if (beta > 70 && s.currentLane < 2 && now - s.lastLaneChangeTime > 800) {
      s.currentLane += 1;
      s.targetY = LANES[s.currentLane];
      s.lastLaneChangeTime = now;
      vibrate(30);
      playSound("lane", 0.5);
    }

    s.gamma = gamma;
    s.beta = beta;

    const tilt = gamma / 90;
    if (tilt > 0.1) s.vx = Math.min(s.vx + tilt * 180 * 0.016, s.maxVx);
    else if (tilt < -0.1) s.vx = Math.max(s.vx + tilt * 180 * 0.016, s.minVx);
    else {
      if (s.vx > 140) s.vx -= 80 * 0.016;
      if (s.vx < 140) s.vx += 80 * 0.016;
    }
  };

  function animate() {
    rafRef.current = requestAnimationFrame(animate);
    const s = stateRef.current;
    const now = performance.now();
    const dt = Math.min(now - s.last, 50) / 1000;
    s.last = now;

    if (!running) return;

    // Jump physics
    if (s.isJumping) {
      s.jumpVelocity += 40 * dt; // gravity
      s.y += s.jumpVelocity * dt * 60;
      if (s.y >= s.targetY) {
        s.y = s.targetY;
        s.isJumping = false;
        s.jumpVelocity = 0;
      }
    }

    if (Math.abs(s.y - s.targetY) > 0.5) {
      s.y += (s.targetY - s.y) * 0.3;
    } else {
      s.y = s.targetY;
    }

    s.scrollX += s.vx * dt;
    while (s.obstacles.length < 8 && Math.random() < 0.25) spawnObstacle(s);
    while (s.treasures.length < 5 && Math.random() < 0.18) spawnTreasure(s);

    const px = s.x;
    const py = s.y;
    const pw = 24;
    const ph = 18;

    s.treasures = s.treasures.filter((t) => {
      const tx = t.x - s.scrollX;
      if (tx < -30) return false;
      const hit = tx < px + pw && tx + t.w > px && t.y < py + ph && t.y + t.h > py;
      if (hit) {
        if (t.type === "coin") {
          s.collectibles += 1;
          bumpScore(p => p + 5);
          vibrate(50);
          playSound("coin");
        } else {
          s.boosts += 1;
          bumpScore(p => p + 10);
          s.vx = s.maxVx;
          vibrate([50, 30, 50]);
          playSound("boost");
        }
      }
      return !hit;
    });

    const nowTime = now;
    s.obstacles = s.obstacles.filter((o) => {
      const ox = o.x - s.scrollX;
      if (ox < -30) return false;
      const hit = ox < px + pw && ox + o.w > px && o.y < py + ph && o.y + o.h > py;
      if (hit && s.shieldMs <= 0) {
        s.hits += 1;
        bumpScore(p => Math.max(0, p - 3));
        s.vx *= 0.65;
        vibrate([100, 50, 100]);
        playSound("hit");
        s.shieldMs = 1200;
      }

      const near = Math.abs(ox + o.w / 2 - (px + pw / 2)) < 40 && Math.abs(o.y + o.h / 2 - py) < 30;
      if (near && !hit && nowTime - s.lastNearMissTime > 400) {
        vibrate(25);
        playSound("nearMiss", 0.4);
        s.lastNearMissTime = nowTime;
      }

      return true;
    });

    if (s.shieldMs > 0) s.shieldMs -= dt * 1000;

    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, 520, 240);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 520, 240);

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    LANES.forEach((ly) => {
      ctx.beginPath();
      ctx.moveTo(0, ly + 10);
      ctx.lineTo(520, ly + 10);
      ctx.stroke();
    });

    ctx.fillStyle = "#ef4444";
    s.obstacles.forEach((o) => ctx.fillRect(o.x - s.scrollX, o.y - 9, o.w, o.h));

    s.treasures.forEach((t) => {
      ctx.fillStyle = t.type === "coin" ? "#facc15" : "#22c55e";
      ctx.beginPath();
      ctx.arc(t.x - s.scrollX + 10, t.y, 10, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = s.shieldMs > 0 ? "rgba(34,197,94,0.75)" : "#0ea5e9";
    ctx.fillRect(s.x, s.y - 9, pw, ph);

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`Coins: ${s.collectibles}`, 12, 28);
    ctx.fillText(`Boosts: ${s.boosts}`, 12, 48);
    ctx.fillText(`Hits: ${s.hits}`, 12, 68);
    ctx.font = "bold 20px system-ui";
    ctx.fillStyle = "#facc15";
    ctx.fillText(`Score: ${scoreRef.current}`, 12, 94);

    // Tilt indicator
    const indX = 460, indY = 30, size = 50;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 3;
    ctx.strokeRect(indX - size / 2, indY - size / 2, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(indX - size / 2, indY - size / 2, size, size);

    const ballX = indX + (s.gamma / 90) * (size / 2 - 10);
    const ballY = indY + ((s.beta - 45) / 90) * (size / 2 - 10);
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(ballX, ballY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(indX - 10, indY);
    ctx.lineTo(indX + 10, indY);
    ctx.moveTo(indX, indY - 10);
    ctx.lineTo(indX, indY + 10);
    ctx.stroke();
  }

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    // Touch drag controls
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);

    // Permission + tilt
    const handleFirstTouch = () => {
      requestPermission();
      canvas.removeEventListener("touchstart", handleFirstTouch);
    };
    canvas.addEventListener("touchstart", handleFirstTouch);

    if (permission === "granted") {
      window.addEventListener("deviceorientation", handleOrientation);
      rafRef.current = requestAnimationFrame(animate);
    }

    const timer = setInterval(() => {
      setTimeLeftMs(p => {
        if (p <= 1000) {
          setRunning(false);
          return 0;
        }
        return p - 1000;
      });
    }, 1000);

    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
      window.removeEventListener("deviceorientation", handleOrientation);
      cancelAnimationFrame(rafRef.current);
      clearInterval(timer);
      canvas.removeEventListener("touchstart", handleFirstTouch);
    };
  }, [running, disabled, permission]);

  useEffect(() => {
    if (timeLeftMs <= 0 && !result) {
      setRunning(false);
      const s = stateRef.current;
      const finalPoints = scoreRef.current;

      // Compact summary payload for reporting (avoid huge state blobs in transcripts)
      const summary = {
        taskType: "treasure-runner",
        pointsEarned: finalPoints,
        coins: Number(s.collectibles) || 0,
        boosts: Number(s.boosts) || 0,
        hits: Number(s.hits) || 0,
        durationSeconds: 60,
        finalSpeed: Math.round(Number(s.vx) || 0),
        controls: {
          tapJump: true,
          swipeDownDrop: true,
          tiltEnabled: permission === "granted",
        },
      };

      setResult({
        pointsEarned: summary.pointsEarned,
        collectibles: summary.coins,
        boosts: summary.boosts,
        hits: summary.hits,
      });

      // Submit a compact payload (answerPayload + answer string) so reporting can render it nicely.
      if (onSubmit) onSubmit({
        type: "treasure-runner",
        answer: JSON.stringify(summary),
        answerPayload: summary,
        pointsEarned: summary.pointsEarned,
      });

      if (socket && me.roomCode && me.teamId && !s.sent) {
        s.sent = true;
        socket.emit("score:add", { roomCode: me.roomCode, teamId: me.teamId, delta: finalPoints, reason: "TreasureRunner" });
        socket.emit("treasure:finish", { roomCode: me.roomCode, teamId: me.teamId, ...summary });
      }
    }
  }, [timeLeftMs, running, result, socket, onSubmit, me, currentScore, permission]);

  const secondsLeft = Math.ceil(timeLeftMs / 1000);

  return (
    <div style={{ opacity: disabled ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>Treasure Runner</div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>
          {result ? "Finished!" : `Time: ${secondsLeft}s`}
        </div>
      </div>

      {permission !== "granted" && (
        <div style={{ marginTop: 10, padding: 12, background: "rgba(255,255,255,0.1)", borderRadius: 12 }}>
          <div style={{ fontWeight: 700 }}>Controls</div>
          <div style={{ fontSize: "0.9rem", opacity: 0.9 }}>
            Tap to jump • Swipe down mid-air to drop • Drag left/right for speed • Drag up/down for lanes • Tilt for extra control
          </div>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <canvas ref={canvasRef} width={520} height={240}
          style={{
            width: "100%",
            maxWidth: 720,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(15,23,42,0.75)",
            touchAction: "none",
          }}
        />
      </div>

      {!result ? (
        <div style={{ marginTop: 10, opacity: 0.9, textAlign: "center" }}>
          Tap to jump over obstacles! Combine with drag and tilt.
        </div>
      ) : (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)" }}>
          <div style={{ fontWeight: 900, fontSize: "1.2rem" }}>Final Score: {currentScore} points!</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            Coins: <strong>{result.collectibles}</strong> • Boosts: <strong>{result.boosts}</strong> • Hits: <strong>{result.hits}</strong>
          </div>
        </div>
      )}
    </div>
  );
}