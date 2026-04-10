import React, { useEffect, useMemo, useRef, useState } from "react";
import VictoryScreen from "../../VictoryScreen";

export default function TrueFalseTicTacToeTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamRole: teamRoleProp,
  memberNames = [],
  remainingMs = 0,
  timeLimitSeconds = 0,
}) {
  const [board, setBoard] = useState(task.board || Array(9).fill(null));
  const [usedStatementIds, setUsedStatementIds] = useState(new Set());
  const [activeStatement, setActiveStatement] = useState(null); // tap-to-place
  const [hintPulse, setHintPulse] = useState(false); // flash grid when statement selected
  const hasSubmittedRef = useRef(false); // prevent double submission

  // ─── Local turn management ───
  // Player 0 = "O" (TRUE / Blue), Player 1 = "X" (FALSE / Red)
  // If server assigned a teamRole (inter-team), we use it for everyone.
  // If not (intra-team), we alternate locally.
  const isIntraTeam = !teamRoleProp;
  const [currentTurn, setCurrentTurn] = useState(0); // 0 or 1
  const currentRole = isIntraTeam ? (currentTurn === 0 ? "O" : "X") : (teamRoleProp || "O");

  // Keep local board in sync if parent/task updates it (e.g., from socket events).
  useEffect(() => {
    if (Array.isArray(task?.board) && task.board.length === 9) {
      setBoard(task.board);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.board]);

  const roleLabel = currentRole === "X" ? "FALSE" : "TRUE";
  const roleColor = currentRole === "X" ? "Red" : "Blue";
  const roleCls = currentRole === "X" ? "text-red-600" : "text-blue-600";

  const names = (() => {
    const raw =
      Array.isArray(task?.playerNames) ? task.playerNames :
      Array.isArray(task?.players) ? task.players.map((p) => p?.name || p?.displayName || p).filter(Boolean) :
      Array.isArray(task?.config?.players) ? task.config.players :
      Array.isArray(memberNames) && memberNames.length ? memberNames :
      null;
    const base = Array.isArray(raw) && raw.length
      ? raw.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    return base.length ? base : ["Player 1", "Player 2"];
  })();

  // In intra-team mode, alternate between first two names.
  // In inter-team mode, use server-provided index or default to 0.
  const activePlayerIndex = isIntraTeam
    ? (currentTurn % Math.max(names.length, 2))
    : (
        Number.isFinite(Number(task?.activePlayerIndex)) ? Number(task.activePlayerIndex) :
        Number.isFinite(Number(task?.turnIndex)) ? Number(task.turnIndex) :
        0
      );

  const activeName = names[activePlayerIndex] || `Player ${activePlayerIndex + 1}`;
  const [showVictory, setShowVictory] = useState(false);

  useEffect(() => {
    if (task.winner) {
      if (task.winner === currentRole) {
        try {
          new Audio("/sounds/victory.mp3").play();
        } catch {
          // ignore autoplay errors
        }
        setShowVictory(true);
        setTimeout(() => setShowVictory(false), 5000);
      } else {
        try {
          new Audio("/sounds/lose.mp3").play();
        } catch {
          // ignore autoplay errors
        }
      }
    }
  }, [task.winner, currentRole]);

  // Core logic: given a statement + board index, apply the move.
  // The piece color is determined by the STATEMENT's truth value, not by who plays it.
  // True statement → Blue O, False statement → Red X — always.
  const applyMove = (statement, index) => {
    if (!statement || disabled || board[index]) return;

    // Statement truth determines the piece: true → O (Blue), false → X (Red)
    const placedRole = statement.isFalse ? "X" : "O";

    const newBoard = [...board];
    newBoard[index] = placedRole;
    setBoard(newBoard);

    socket?.emit("tictactoe-move", {
      roomCode: task.roomCode,
      index,
      teamRole: placedRole,
    });

    // Remove the used statement from the available pool
    setUsedStatementIds((prev) => new Set(prev).add(statement.id));
    setActiveStatement(null);

    // Advance turn in intra-team mode
    if (isIntraTeam) {
      setCurrentTurn((prev) => (prev + 1) % Math.max(names.length, 2));
    }
  };

  // ─── Touch-friendly drag support ───
  // HTML5 draggable doesn't work on mobile/tablets.
  // We use a ref-based touch tracker: touchStart captures the statement,
  // touchEnd checks if the finger landed on a grid cell.
  const touchStatementRef = useRef(null);
  const gridCellRefs = useRef([]);

  const handleTouchStart = (e, statement) => {
    if (disabled) return;
    touchStatementRef.current = statement;
    setActiveStatement(statement);
  };

  const handleTouchEnd = (e) => {
    if (disabled || !touchStatementRef.current) return;
    const touch = e.changedTouches?.[0];
    if (!touch) { touchStatementRef.current = null; return; }

    // Find which grid cell the finger ended on
    for (let i = 0; i < 9; i++) {
      const el = gridCellRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (
        touch.clientX >= rect.left &&
        touch.clientX <= rect.right &&
        touch.clientY >= rect.top &&
        touch.clientY <= rect.bottom
      ) {
        applyMove(touchStatementRef.current, i);
        touchStatementRef.current = null;
        return;
      }
    }
    // Didn't land on a cell — keep statement selected for tap-to-place
    touchStatementRef.current = null;
  };

  // Desktop drag start
  const handleDragStart = (e, statement) => {
    if (disabled) return;
    setActiveStatement(statement);
    // Store statement index in dataTransfer for drop handler
    e.dataTransfer.setData("text/plain", JSON.stringify(statement));
  };

  // Desktop drop target
  const handleDrop = (e, index) => {
    e.preventDefault();
    if (disabled) return;
    let stmt = activeStatement;
    try {
      stmt = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {}
    applyMove(stmt, index);
  };

  const allowDrop = (e) => e.preventDefault();

  // Touch / click: tap statement to select, then tap a cell to place it
  const handleStatementClick = (statement) => {
    if (disabled) return;
    setActiveStatement(statement);
    // Flash the grid to show "now tap a square"
    setHintPulse(true);
    setTimeout(() => setHintPulse(false), 1200);
  };

  const handleCellClick = (index) => {
    if (disabled) return;
    if (!activeStatement) {
      // Flash the statement area to hint "pick a statement first"
      setHintPulse(true);
      setTimeout(() => setHintPulse(false), 1200);
      return;
    }
    applyMove(activeStatement, index);
  };

  const { winner, line: winLine } = calculateWinner(board);
  const boardFull = board.every((c) => c !== null);

  // ─── Submit score when game ends (win or draw) ───
  useEffect(() => {
    if (hasSubmittedRef.current) return;
    if (!winner && !boardFull) return;

    hasSubmittedRef.current = true;

    // ── Scoring constants ──
    const BASE_WIN = 100;        // each winning-side player gets this
    const PARTICIPATION = 15;    // everyone gets this for playing
    const SPEED_BONUS_MAX = 50;  // max bonus for finishing quickly

    // Speed bonus: proportion of time remaining × max bonus
    const speedBonus =
      timeLimitSeconds > 0 && remainingMs > 0
        ? Math.round((remainingMs / (timeLimitSeconds * 1000)) * SPEED_BONUS_MAX)
        : 0;

    // Count pieces for each side
    const oCount = board.filter((c) => c === "O").length;
    const xCount = board.filter((c) => c === "X").length;

    // Player 0 = O (TRUE/Blue), Player 1 = X (FALSE/Red)
    // Build per-player score breakdown
    const playerScores = names.map((name, i) => {
      const role = i === 0 ? "O" : "X";
      const isWinner = winner && winner === role;
      const isDraw = !winner;
      const winPts = isWinner ? BASE_WIN : 0;
      const drawPts = isDraw ? Math.round(BASE_WIN * 0.25) : 0;
      const total = winPts + drawPts + PARTICIPATION + speedBonus;
      return {
        name,
        role,
        roleLabel: role === "O" ? "TRUE (Blue)" : "FALSE (Red)",
        isWinner: !!isWinner,
        breakdown: { win: winPts, draw: drawPts, participation: PARTICIPATION, speedBonus },
        points: total,
      };
    });

    // Team score = sum of all individual player points
    const teamPointsEarned = playerScores.reduce((sum, p) => sum + p.points, 0);

    onSubmit?.({
      type: "true-false-tictactoe",
      taskType: "true-false-tictactoe",
      gameComplete: true,
      completed: true,
      winner: winner || "draw",
      winnerLabel: winner === "O" ? "TRUE (Blue)" : winner === "X" ? "FALSE (Red)" : "Draw",
      winnerPlayer: winner
        ? (winner === "O" ? names[0] : names[1] || "Player 2")
        : null,
      winLine: winLine || null,
      board: [...board],
      movesPlayed: board.filter((c) => c !== null).length,
      oCount,
      xCount,
      players: names,
      playerScores,
      pointsEarned: teamPointsEarned,
      teamPointsEarned,
      speedBonus,
      submittedAt: new Date().toISOString(),
    });
  }, [winner, boardFull]); // eslint-disable-line react-hooks/exhaustive-deps

  // Defensive: if statements are missing, try common shapes so the game is still playable.
  const statements = useMemo(() => {
    const raw = Array.isArray(task?.statements)
      ? task.statements
      : Array.isArray(task?.items)
        ? task.items
        : Array.isArray(task?.config?.statements)
          ? task.config.statements
          : [];

    const mapped = Array.isArray(raw)
      ? raw
          .map((s, idx) => {
            if (!s) return null;
            if (typeof s === "string") {
              return { text: s, isFalse: false, id: `s${idx}` };
            }
            const text = String(s.text || s.prompt || s.statement || "").trim();
            if (!text) return null;
            const isFalse =
              typeof s.isFalse === "boolean"
                ? s.isFalse
                : typeof s.correct === "boolean"
                  ? !s.correct
                  : typeof s.answer === "string"
                    ? String(s.answer).toLowerCase() === "false"
                    : false;
            return { text, isFalse, id: String(s.id || s._id || `s${idx}`) };
          })
          .filter(Boolean)
      : [];

    if (mapped.length) return mapped;

    const seed = String(task?.prompt || task?.title || "this topic").trim();
    return [
      { id: "ph1", text: `"${seed}" is the topic for this round.`, isFalse: false },
      { id: "ph2", text: `"${seed}" happened in the year 3000.`, isFalse: true },
      { id: "ph3", text: `"${seed}" has a cause and an effect.`, isFalse: false },
      { id: "ph4", text: `"${seed}" was invented by a talking penguin.`, isFalse: true },
    ];
  }, [task?.statements, task?.items, task?.config?.statements, task?.prompt, task?.title]);

  const instructions =
    "Pick a statement bubble below, then tap an empty square to place it. " +
    "TRUE statements always go Blue (O), FALSE statements always go Red (X). " +
    `You're playing ${roleLabel} (${roleColor}) — get 3 in a row to win!`;

  return (
    <div className="flex flex-col items-center justify-center h-full p-6" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(14,165,233,0.10))", borderRadius: 18 }}>
      <h2 className="text-4xl font-bold mb-4 text-indigo-700">
        TRUE/FALSE TIC-TAC-TOE BATTLE!
      </h2>
      <div className="w-full max-w-3xl mb-6">
        <div className="rounded-2xl p-4 shadow-sm border border-slate-200 bg-white/80">
          <div className="text-2xl">
            <span className="font-extrabold">{activeName}</span>{" "}
            <span className="text-slate-500">is playing</span>{" "}
            <span className={`font-extrabold ${roleCls}`}>{roleLabel} ({roleColor})</span>
          </div>
          <div className="mt-2 text-slate-700 text-base leading-relaxed">
            <div className="font-semibold mb-1">Instructions</div>
            <div className="text-slate-700">{instructions}</div>
          </div>
        </div>
      </div>

      {/* Active statement indicator */}
      {activeStatement && (
        <div className="mb-3 px-4 py-2 bg-indigo-100 border-2 border-indigo-400 rounded-xl text-indigo-800 font-bold text-center text-lg animate-pulse">
          Now tap an empty square to place it!
        </div>
      )}
      {!activeStatement && hintPulse && (
        <div className="mb-3 px-4 py-2 bg-yellow-100 border-2 border-yellow-400 rounded-xl text-yellow-800 font-bold text-center text-lg animate-pulse">
          Pick a statement bubble first!
        </div>
      )}

      {/* TIC-TAC-TOE GRID */}
      <div
        className={[
          "relative grid grid-cols-3 gap-4 mb-8 p-6 rounded-2xl border shadow-md transition-all duration-300",
          activeStatement
            ? "bg-indigo-50 border-indigo-300 shadow-indigo-200"
            : "bg-white/80 border-slate-200",
        ].join(" ")}
      >
        {/* Winning strike-through line */}
        {winLine && (
          <WinLine cells={winLine} cols={3} />
        )}
        {board.map((cell, i) => {
          const isEmpty = !cell;
          const canPlace = activeStatement && isEmpty && !disabled;
          return (
            <div
              key={i}
              ref={(el) => { gridCellRefs.current[i] = el; }}
              onDrop={(e) => handleDrop(e, i)}
              onDragOver={allowDrop}
              onClick={() => handleCellClick(i)}
              className={[
                "w-24 h-24 rounded-xl flex items-center justify-center text-6xl font-bold transition-all duration-200",
                cell === "X"
                  ? "border-4 border-red-400 bg-red-100"
                  : cell === "O"
                    ? "border-4 border-blue-400 bg-blue-100"
                    : canPlace
                      ? "bg-indigo-100 border-4 border-indigo-400 cursor-pointer hover:bg-indigo-200 hover:scale-105 active:scale-95"
                      : "bg-white border-4 border-gray-300 cursor-pointer",
                canPlace ? "animate-pulse" : "",
              ].join(" ")}
              style={
                cell === "X" ? { boxShadow: "0 0 10px rgba(239,68,68,0.35)" } :
                cell === "O" ? { boxShadow: "0 0 10px rgba(59,130,246,0.35)" } :
                canPlace ? { boxShadow: "0 0 12px rgba(99,102,241,0.4)" } : {}
              }
            >
              {cell === "X" && <span className="text-red-600 drop-shadow-sm">X</span>}
              {cell === "O" && <span className="text-blue-600 drop-shadow-sm">O</span>}
            </div>
          );
        })}
      </div>

      {/* STATEMENT CARDS */}
      <div className="space-y-4 w-full max-w-md">
        <p className={[
          "text-lg font-semibold text-center transition-colors duration-300",
          !activeStatement && hintPulse ? "text-yellow-600" : "text-slate-700",
        ].join(" ")}>
          Tap a statement, then tap a square to place it.
        </p>
        {statements
          .filter((stmt) => !usedStatementIds.has(stmt.id))
          .map((stmt, i) => {
          const isActive =
            activeStatement && activeStatement.id === stmt.id;
          return (
            <div
              key={stmt.id || i}
              draggable={!disabled}
              onDragStart={(e) => handleDragStart(e, stmt)}
              onTouchStart={(e) => handleTouchStart(e, stmt)}
              onTouchEnd={handleTouchEnd}
              onClick={() => handleStatementClick(stmt)}
              className={[
                "p-4 rounded-lg text-lg font-medium text-center transition-all duration-200 cursor-pointer select-none",
                stmt.isFalse ? "bg-red-100 border-2 border-red-400" : "bg-green-100 border-2 border-green-400",
                disabled ? "opacity-50" : "hover:scale-105 active:scale-95",
                isActive ? "ring-4 ring-indigo-500 scale-105 shadow-lg" : "",
              ].join(" ")}
            >
              {stmt.text}
            </div>
          );
        })}
      </div>

      {/* WINNER DISPLAY */}
      {winner && (
        <div className="mt-8 text-center animate-pulse">
          <div className="text-5xl font-bold">
            {winner === "O" ? (
              <span className="text-blue-600">TRUE (Blue) WINS!</span>
            ) : (
              <span className="text-red-600">FALSE (Red) WINS!</span>
            )}
          </div>
          {isIntraTeam && (
            <div className="text-2xl mt-2 font-semibold text-slate-700">
              {winner === "O" ? names[0] : names[1] || "Player 2"} takes the round!
            </div>
          )}
        </div>
      )}

      {/* Victory overlay */}
      {showVictory && (
        <VictoryScreen onClose={() => setShowVictory(false)} />
      )}
    </div>
  );
}

/**
 * SVG overlay that draws a strike-through line across winning cells.
 * Uses CSS percentage coordinates so it works regardless of cell size.
 * `cells` is [i, j, k] for TicTacToe or [i, j, k, l] for Connect Four.
 * `cols` is the number of columns in the grid.
 */
function WinLine({ cells, cols = 3, totalRows }) {
  if (!cells || cells.length < 3) return null;

  const first = cells[0];
  const last = cells[cells.length - 1];
  const numRows = totalRows || cols; // default to square grid

  // Convert flat index to (row, col)
  const r1 = Math.floor(first / cols);
  const c1 = first % cols;
  const r2 = Math.floor(last / cols);
  const c2 = last % cols;

  // Convert to percentage positions (center of each cell)
  const x1 = ((c1 + 0.5) / cols) * 100;
  const y1 = ((r1 + 0.5) / numRows) * 100;
  const x2 = ((c2 + 0.5) / cols) * 100;
  const y2 = ((r2 + 0.5) / numRows) * 100;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10, width: "100%", height: "100%" }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <line
        x1={x1} y1={y1}
        x2={x2} y2={y2}
        stroke="rgba(250, 204, 21, 0.9)"
        strokeWidth="4"
        strokeLinecap="round"
        style={{
          filter: "drop-shadow(0 0 6px rgba(250, 204, 21, 0.6))",
        }}
      />
    </svg>
  );
}

/**
 * Returns { winner: "X"|"O"|null, line: [i,j,k]|null }
 */
function calculateWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const line of lines) {
    if (
      board[line[0]] &&
      board[line[0]] === board[line[1]] &&
      board[line[0]] === board[line[2]]
    ) {
      return { winner: board[line[0]], line };
    }
  }
  return { winner: null, line: null };
}
