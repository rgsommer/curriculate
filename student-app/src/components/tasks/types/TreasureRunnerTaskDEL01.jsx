// student-app/src/components/tasks/types/TreasureRunnerTask.jsx
import React, { useEffect, useState, useRef } from "react";

const TreasureRunnerTask = ({ task, socket, roomCode, teamId }) => {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const player = {
    x: 50,
    y: 200,
    width: 40,
    height: 40,
    velocityY: 0,
    jumping: false,
    emoji: task.config.teamEmoji || "🏃‍♂️",
  };

  const obstacles = useRef([]);
  const treasures = useRef([]);
  const frameRef = useRef(0);

  const GRAVITY = 0.8;
  const JUMP_STRENGTH = -15;
  const GROUND_Y = 240;

  const handleJump = () => {
    if (!player.jumping && !gameOver) {
      player.velocityY = JUMP_STRENGTH;
      player.jumping = true;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = 300;

    // Touch/click to jump
    canvas.addEventListener("click", handleJump);
    canvas.addEventListener("touchstart", handleJump);

    let lastTime = 0;
    const gameLoop = (time) => {
      if (!lastTime) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;

      if (!gameOver) {
        // Update player
        player.velocityY += GRAVITY;
        player.y += player.velocityY;
        if (player.y >= GROUND_Y) {
          player.y = GROUND_Y;
          player.jumping = false;
          player.velocityY = 0;
        }

        // Spawn obstacles/treasures
        frameRef.current++;
        if (frameRef.current % 120 === 0) {
          obstacles.current.push({
            x: canvas.width,
            width: 40,
            height: 40,
          });
        }
        if (frameRef.current % 180 === 0) {
          treasures.current.push({
            x: canvas.width,
            width: 30,
            height: 30,
          });
        }

        // Move objects
        obstacles.current = obstacles.current.filter(o => {
          o.x -= 5;
          return o.x + o.width > 0;
        });
        treasures.current = treasures.current.filter(t => {
          t.x -= 5;
          return t.x + t.width > 0;
        });

        // Collision
        obstacles.current.forEach(o => {
          if (
            player.x < o.x + o.width &&
            player.x + player.width > o.x &&
            player.y < o.y + o.height &&
            player.y + player.height > o.y
          ) {
            setGameOver(true);
          }
        });

        // Collect treasures
        treasures.current = treasures.current.filter(t => {
          if (
            player.x < t.x + t.width &&
            player.x + player.width > t.x &&
            player.y < t.y + t.height &&
            player.y + player.height > t.y
          ) {
            setScore(s => s + 5);
            return false;
          }
          return true;
        });

        setScore(s => s + 0.1); // Survival points
      }

      // Draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Ground
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(0, 280, canvas.width, 20);

      // Player
      ctx.font = "40px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(player.emoji, player.x + player.width / 2, player.y + player.height / 2);

      // Obstacles
      ctx.fillStyle = "#4b5563";
      obstacles.current.forEach(o => {
        ctx.fillRect(o.x, 260, o.width, o.height);
      });

      // Treasures
      ctx.fillStyle = "#fbbf24";
      treasures.current.forEach(t => {
        ctx.fillRect(t.x, 250, t.width, t.height);
      });

      // Score
      ctx.fillStyle = "#1e293b";
      ctx.font = "24px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`Score: ${Math.floor(score)}`, 20, 40);

      if (!gameOver) requestAnimationFrame(gameLoop);
    };

    requestAnimationFrame(gameLoop);

    return () => {
      canvas.removeEventListener("click", handleJump);
      canvas.removeEventListener("touchstart", handleJump);
    };
  }, [gameOver]);

  return (
    <div style={{ textAlign: "center", padding: 20 }}>
      <h2>Treasure Runner – Earn Bonus Points!</h2>
      <p>Tap to jump over obstacles and collect treasures while waiting</p>
      <canvas ref={canvasRef} style={{ border: "4px solid #6366f1", borderRadius: 16, maxWidth: "100%" }} />
      {gameOver && <p style={{ fontSize: "1.5rem", marginTop: 20 }}>Game Over! Final Score: {Math.floor(score)}</p>}
    </div>
  );
};

export default TreasureRunnerTask;