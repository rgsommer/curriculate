import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * TowerBuilderTask — students build a tower by choosing statements.
 *
 * Binary mode (true/false):
 *   TRUE  → solid block, tower grows
 *   FALSE → mushy block, tower partially collapses back to last solid
 *
 * Tri-state mode (benefit/harm/neutral):
 *   BENEFIT → solid block, full height
 *   NEUTRAL → wobbly smaller block, half height (stays)
 *   HARM    → mushy block, tower collapses to last non-harm block
 *
 * Statements are shown one at a time. Player taps "Stack it!" to place.
 * Optionally can skip (costs nothing).
 */
export default function TowerBuilderTask({
  task,
  onSubmit,
  disabled,
  memberNames = [],
  remainingMs = 0,
  timeLimitSeconds = 0,
}) {
  // ─── Parse statements ───
  const statements = useMemo(() => {
    const raw =
      Array.isArray(task?.statements) ? task.statements :
      Array.isArray(task?.items) ? task.items :
      Array.isArray(task?.config?.statements) ? task.config.statements :
      Array.isArray(task?.config?.items) ? task.config.items :
      [];

    return raw.map((s, idx) => {
      if (!s) return null;
      if (typeof s === "string") return { text: s, category: "benefit", id: `s${idx}` };

      const text = String(s.text || s.prompt || s.statement || "").trim();
      if (!text) return null;

      // Tri-state: benefit / harm / neutral
      let category = "benefit";
      if (s.category) {
        category = String(s.category).toLowerCase();
      } else if (typeof s.correctAnswer === "boolean") {
        category = s.correctAnswer ? "benefit" : "harm";
      } else if (typeof s.isFalse === "boolean") {
        category = s.isFalse ? "harm" : "benefit";
      } else if (typeof s.answer === "boolean") {
        category = s.answer ? "benefit" : "harm";
      } else if (typeof s.correct === "boolean") {
        category = s.correct ? "benefit" : "harm";
      }

      return { text, category, id: String(s.id || s._id || `s${idx}`) };
    }).filter(Boolean);
  }, [task?.statements, task?.items, task?.config?.statements, task?.config?.items]);

  const isTriState = useMemo(
    () => statements.some((s) => s.category === "neutral"),
    [statements],
  );

  // ─── Game state ───
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tower, setTower] = useState([]);         // array of { text, category, height }
  const [phase, setPhase] = useState("choosing");  // choosing | stacking | wobbling | collapsing | done
  const [lastResult, setLastResult] = useState(null); // "solid" | "wobbly" | "collapse" | null
  const [score, setScore] = useState(0);
  const [maxHeight, setMaxHeight] = useState(0);
  const [collapseTarget, setCollapseTarget] = useState(null); // index to collapse to
  const hasSubmittedRef = useRef(false);
  const [shakingBlock, setShakingBlock] = useState(null); // index of block that's shaking before collapse

  const currentStatement = statements[currentIndex] || null;
  const isGameOver = currentIndex >= statements.length || phase === "done";

  // ─── Scoring constants ───
  const PTS_SOLID = 20;
  const PTS_WOBBLY = 10;
  const PTS_SURVIVE = 5;  // per solid block that survives to end
  const SPEED_BONUS_MAX = 50;

  // ─── Place the current block ───
  function stackBlock() {
    if (disabled || phase !== "choosing" || !currentStatement) return;

    const cat = currentStatement.category;
    setPhase("stacking");

    // Brief delay for "placing" animation
    setTimeout(() => {
      if (cat === "benefit") {
        // Solid block
        const newBlock = { ...currentStatement, height: 1, status: "solid" };
        setTower((prev) => [...prev, newBlock]);
        setScore((s) => s + PTS_SOLID);
        setMaxHeight((h) => h + 1);
        setLastResult("solid");
        setPhase("choosing");
        setCurrentIndex((i) => i + 1);
      } else if (cat === "neutral") {
        // Wobbly block — stays, half height
        const newBlock = { ...currentStatement, height: 0.5, status: "wobbly" };
        setTower((prev) => [...prev, newBlock]);
        setScore((s) => s + PTS_WOBBLY);
        setMaxHeight((h) => h + 0.5);
        setLastResult("wobbly");
        setPhase("choosing");
        setCurrentIndex((i) => i + 1);
      } else {
        // Harm — mushy block, show it wobbling then collapse
        const mushyBlock = { ...currentStatement, height: 1, status: "mushy" };
        setTower((prev) => [...prev, mushyBlock]);
        setShakingBlock(tower.length); // the index of the newly added block
        setPhase("wobbling");

        setTimeout(() => {
          // Find last solid/wobbly block index to collapse to
          const lastGoodIdx = (() => {
            for (let i = tower.length - 1; i >= 0; i--) {
              if (tower[i].status === "solid" || tower[i].status === "wobbly") return i;
            }
            return -1;
          })();

          setCollapseTarget(lastGoodIdx);
          setPhase("collapsing");
          setLastResult("collapse");

          setTimeout(() => {
            // Actually remove blocks above lastGoodIdx
            setTower((prev) => prev.slice(0, lastGoodIdx + 1));
            setShakingBlock(null);
            setCollapseTarget(null);

            // Recalculate height
            const surviving = tower.slice(0, lastGoodIdx + 1);
            const newHeight = surviving.reduce((sum, b) => sum + (b.height || 0), 0);
            setMaxHeight(newHeight);

            setPhase("choosing");
            setCurrentIndex((i) => i + 1);
          }, 800);
        }, 1000);
      }
    }, 400);
  }

  // ─── Skip the current statement ───
  function skipBlock() {
    if (disabled || phase !== "choosing" || !currentStatement) return;
    setLastResult(null);
    setCurrentIndex((i) => i + 1);
  }

  // ─── Submit when all statements have been seen ───
  useEffect(() => {
    if (hasSubmittedRef.current) return;
    if (currentIndex < statements.length || phase !== "choosing") return;

    setPhase("done");
    hasSubmittedRef.current = true;

    const speedBonus =
      timeLimitSeconds > 0 && remainingMs > 0
        ? Math.round((remainingMs / (timeLimitSeconds * 1000)) * SPEED_BONUS_MAX)
        : 0;

    const survivalBonus = tower.filter((b) => b.status === "solid" || b.status === "wobbly").length * PTS_SURVIVE;
    const finalHeight = tower.reduce((sum, b) => sum + (b.height || 0), 0);
    const totalScore = score + survivalBonus + speedBonus;

    const names = Array.isArray(memberNames) && memberNames.length ? memberNames : ["Player 1"];

    onSubmit?.({
      type: "tower-builder",
      taskType: "tower-builder",
      gameComplete: true,
      completed: true,
      towerHeight: finalHeight,
      blocksPlaced: tower.length,
      blocksTotal: statements.length,
      tower: tower.map((b) => ({ text: b.text, category: b.category, status: b.status })),
      pointsEarned: totalScore,
      teamPointsEarned: totalScore,
      playerScores: names.map((name) => ({
        name,
        points: totalScore,
        breakdown: { building: score, survival: survivalBonus, speedBonus },
      })),
      speedBonus,
      submittedAt: new Date().toISOString(),
    });
  }, [currentIndex, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Compute visual tower height ───
  const towerHeight = tower.reduce((sum, b) => sum + (b.height || 0), 0);
  const progress = statements.length > 0 ? Math.round((currentIndex / statements.length) * 100) : 0;

  // ─── Render ───
  return (
    <div style={S.page}>
      <h2 style={S.title}>TOWER BUILDER</h2>
      <div style={S.subtitle}>
        {isTriState
          ? "Stack benefits to build tall. Avoid harms or your tower collapses! Neutrals are wobbly but hold."
          : "Stack the TRUE statements to build tall. Pick a FALSE one and your tower crumbles!"}
      </div>

      {/* Progress bar */}
      <div style={S.progressWrap}>
        <div style={{ ...S.progressBar, width: `${progress}%` }} />
      </div>
      <div style={S.progressLabel}>
        {currentIndex} / {statements.length} statements &nbsp;|&nbsp; Score: {score} &nbsp;|&nbsp; Height: {towerHeight.toFixed(1)}
      </div>

      {/* Tower visualization */}
      <div style={S.towerArea}>
        <div style={S.towerContainer}>
          {/* Ground */}
          <div style={S.ground} />

          {/* Blocks (rendered bottom to top) */}
          {tower.map((block, i) => {
            const isShaking = shakingBlock === i;
            const isCollapsing = phase === "collapsing" && collapseTarget !== null && i > collapseTarget;

            return (
              <div
                key={`block-${i}`}
                style={{
                  ...S.block,
                  height: block.height === 0.5 ? 28 : 48,
                  background:
                    block.status === "solid" ? "linear-gradient(135deg, #3b82f6, #2563eb)" :
                    block.status === "wobbly" ? "linear-gradient(135deg, #f59e0b, #d97706)" :
                    "linear-gradient(135deg, #ef4444, #dc2626)",
                  borderColor:
                    block.status === "solid" ? "#1d4ed8" :
                    block.status === "wobbly" ? "#b45309" :
                    "#b91c1c",
                  opacity: isCollapsing ? 0 : 1,
                  transform: isShaking
                    ? "translateX(0)"
                    : isCollapsing
                      ? "translateY(40px) scale(0.8)"
                      : "none",
                  animation: isShaking ? "towerShake 0.15s infinite alternate" : "none",
                  transition: isCollapsing ? "all 0.6s ease-in" : "none",
                }}
              >
                <span style={S.blockLabel}>
                  {block.status === "solid" ? "✓" : block.status === "wobbly" ? "~" : "✗"}
                </span>
              </div>
            );
          })}

          {/* "Placing" preview block */}
          {phase === "stacking" && (
            <div style={{ ...S.block, ...S.placingBlock }}>
              <span style={S.blockLabel}>?</span>
            </div>
          )}
        </div>

        {/* Height marker */}
        <div style={S.heightMarker}>
          <div style={S.heightNum}>{towerHeight.toFixed(1)}</div>
          <div style={S.heightLabel}>height</div>
        </div>
      </div>

      {/* Result flash */}
      {lastResult && phase === "choosing" && (
        <div style={{
          ...S.resultFlash,
          background:
            lastResult === "solid" ? "rgba(59,130,246,0.12)" :
            lastResult === "wobbly" ? "rgba(245,158,11,0.12)" :
            "rgba(239,68,68,0.12)",
          borderColor:
            lastResult === "solid" ? "#3b82f6" :
            lastResult === "wobbly" ? "#f59e0b" :
            "#ef4444",
          color:
            lastResult === "solid" ? "#1d4ed8" :
            lastResult === "wobbly" ? "#b45309" :
            "#dc2626",
        }}>
          {lastResult === "solid" && "Solid! That statement was true — tower grows!"}
          {lastResult === "wobbly" && "Wobbly! That one was neutral — it holds, barely."}
          {lastResult === "collapse" && "Collapse! That was false — tower crumbled!"}
        </div>
      )}

      {/* Current statement card */}
      {!isGameOver && currentStatement && phase === "choosing" && (
        <div style={S.statementCard}>
          <div style={S.statementText}>{currentStatement.text}</div>
          <div style={S.buttonRow}>
            <button
              type="button"
              onClick={skipBlock}
              disabled={disabled}
              style={S.skipBtn}
            >
              Skip
            </button>
            <button
              type="button"
              onClick={stackBlock}
              disabled={disabled}
              style={S.stackBtn}
            >
              Stack it!
            </button>
          </div>
          <div style={S.hint}>
            {isTriState
              ? "Is this a benefit, neutral, or harmful? Benefits build strong. Harms collapse!"
              : "Is this TRUE or FALSE? True statements build strong. False ones collapse your tower!"}
          </div>
        </div>
      )}

      {/* Wobble/collapse message */}
      {(phase === "wobbling" || phase === "collapsing") && (
        <div style={S.collapseMsg}>
          {phase === "wobbling" ? "That block is mushy..." : "COLLAPSE!"}
        </div>
      )}

      {/* Game Over */}
      {isGameOver && (
        <div style={S.gameOver}>
          <div style={S.gameOverIcon}>🏗️</div>
          <div style={S.gameOverTitle}>Tower Complete!</div>
          <div style={S.gameOverStats}>
            Final height: <strong>{towerHeight.toFixed(1)}</strong> &nbsp;|&nbsp;
            Blocks standing: <strong>{tower.length}</strong> / {statements.length} &nbsp;|&nbsp;
            Score: <strong>{score}</strong>
          </div>
        </div>
      )}

      {/* Shake keyframe animation (injected once) */}
      <style>{`
        @keyframes towerShake {
          0% { transform: translateX(-4px) rotate(-1deg); }
          100% { transform: translateX(4px) rotate(1deg); }
        }
        @keyframes blockDrop {
          0% { transform: translateY(-30px); opacity: 0; }
          60% { transform: translateY(4px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───
const S = {
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100%",
    padding: 24,
    background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(14,165,233,0.06))",
    borderRadius: 18,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
  title: {
    fontSize: 32,
    fontWeight: 900,
    color: "#4338ca",
    margin: 0,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: "#475569",
    marginTop: 6,
    textAlign: "center",
    maxWidth: 500,
    lineHeight: 1.4,
  },

  // Progress
  progressWrap: {
    width: "100%",
    maxWidth: 400,
    height: 6,
    borderRadius: 3,
    background: "rgba(15,23,42,0.08)",
    marginTop: 16,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 3,
    background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
    transition: "width 0.4s ease",
  },
  progressLabel: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 6,
    fontWeight: 600,
  },

  // Tower
  towerArea: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 16,
    marginTop: 20,
    minHeight: 220,
    width: "100%",
    maxWidth: 360,
  },
  towerContainer: {
    display: "flex",
    flexDirection: "column-reverse",
    alignItems: "center",
    minHeight: 180,
    position: "relative",
    flex: 1,
  },
  ground: {
    width: 180,
    height: 8,
    borderRadius: 4,
    background: "linear-gradient(90deg, #78716c, #a8a29e)",
    marginBottom: 0,
  },
  block: {
    width: 140,
    borderRadius: 8,
    border: "2px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
    animation: "blockDrop 0.4s ease-out",
  },
  blockLabel: {
    color: "white",
    fontWeight: 900,
    fontSize: 18,
    textShadow: "0 1px 2px rgba(0,0,0,0.3)",
  },
  placingBlock: {
    width: 140,
    height: 48,
    background: "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(99,102,241,0.5))",
    borderColor: "#6366f1",
    borderStyle: "dashed",
    opacity: 0.7,
  },

  // Height marker
  heightMarker: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 12,
  },
  heightNum: {
    fontSize: 28,
    fontWeight: 900,
    color: "#4338ca",
  },
  heightLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // Result flash
  resultFlash: {
    marginTop: 12,
    padding: "8px 18px",
    borderRadius: 12,
    border: "2px solid",
    fontWeight: 700,
    fontSize: 14,
    textAlign: "center",
    maxWidth: 400,
  },

  // Statement card
  statementCard: {
    marginTop: 16,
    padding: 20,
    borderRadius: 16,
    background: "white",
    border: "2px solid rgba(245,158,11,0.4)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    maxWidth: 420,
    width: "100%",
    textAlign: "center",
  },
  statementText: {
    fontSize: 17,
    fontWeight: 600,
    color: "#1e293b",
    lineHeight: 1.45,
  },
  buttonRow: {
    display: "flex",
    justifyContent: "center",
    gap: 12,
    marginTop: 16,
  },
  stackBtn: {
    padding: "12px 28px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #3b82f6, #2563eb)",
    color: "white",
    fontWeight: 900,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(37,99,235,0.35)",
    transition: "transform 0.15s ease",
  },
  skipBtn: {
    padding: "12px 20px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.04)",
    color: "#64748b",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 1.4,
  },

  // Collapse message
  collapseMsg: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: 900,
    color: "#dc2626",
    animation: "towerShake 0.15s infinite alternate",
  },

  // Game over
  gameOver: {
    marginTop: 20,
    textAlign: "center",
    padding: 24,
    borderRadius: 16,
    background: "white",
    border: "2px solid rgba(99,102,241,0.3)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
    maxWidth: 420,
    width: "100%",
  },
  gameOverIcon: { fontSize: 48 },
  gameOverTitle: {
    fontSize: 24,
    fontWeight: 900,
    color: "#4338ca",
    marginTop: 8,
  },
  gameOverStats: {
    fontSize: 15,
    color: "#475569",
    marginTop: 8,
    lineHeight: 1.5,
  },
};
