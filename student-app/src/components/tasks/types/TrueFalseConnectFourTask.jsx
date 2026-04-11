import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VictoryScreen from "../../VictoryScreen";

const COLS = 7;
const ROWS = 6;
const CELLS = COLS * ROWS; // 42

// Convert (row, col) ↔ flat index
const idx = (r, c) => r * COLS + c;
const toRC = (i) => [Math.floor(i / COLS), i % COLS];

/**
 * Find the lowest empty row in a column, or -1 if full.
 */
function lowestEmptyRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!board[idx(r, col)]) return r;
  }
  return -1;
}

/**
 * Check for 4-in-a-row. Returns { winner, line } where line is [i,j,k,l] flat indices.
 */
function calculateWinner(board) {
  const dirs = [
    [0, 1],  // horizontal
    [1, 0],  // vertical
    [1, 1],  // diagonal ↘
    [1, -1], // diagonal ↙
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const val = board[idx(r, c)];
      if (!val) continue;
      for (const [dr, dc] of dirs) {
        const cells = [idx(r, c)];
        for (let step = 1; step < 4; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[idx(nr, nc)] !== val) break;
          cells.push(idx(nr, nc));
        }
        if (cells.length >= 4) return { winner: val, line: cells.slice(0, 4) };
      }
    }
  }
  return { winner: null, line: null };
}

/**
 * SVG overlay for the winning line (works for any grid).
 */
function WinLine({ cells, cols, totalRows }) {
  if (!cells || cells.length < 3) return null;

  const first = cells[0];
  const last = cells[cells.length - 1];
  const r1 = Math.floor(first / cols);
  const c1 = first % cols;
  const r2 = Math.floor(last / cols);
  const c2 = last % cols;

  const x1 = ((c1 + 0.5) / cols) * 100;
  const y1 = ((r1 + 0.5) / totalRows) * 100;
  const x2 = ((c2 + 0.5) / cols) * 100;
  const y2 = ((r2 + 0.5) / totalRows) * 100;

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
        strokeWidth="3"
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 6px rgba(250, 204, 21, 0.6))" }}
      />
    </svg>
  );
}

export default function TrueFalseConnectFourTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamRole: teamRoleProp,
  memberNames = [],
  remainingMs = 0,
  timeLimitSeconds = 0,
}) {
  const [board, setBoard] = useState(task.board || Array(CELLS).fill(null));
  const [usedStatementIds, setUsedStatementIds] = useState(new Set());
  const [roundNumber, setRoundNumber] = useState(1);
  const [activeStatement, setActiveStatement] = useState(null);
  const [hintPulse, setHintPulse] = useState(false);
  const [droppingCol, setDroppingCol] = useState(null);
  const [lastDrop, setLastDrop] = useState(null);
  const hasSubmittedRef = useRef(false);

  // ─── Multi-win tracking ───
  // Connect Four keeps playing after a 4-in-a-row to maximize exposure to T/F clues.
  // Each win is scored, the winning line is highlighted briefly, then play continues.
  const [wins, setWins] = useState({ O: 0, X: 0 });  // win tally per side
  const [currentWinLine, setCurrentWinLine] = useState(null); // active strike-through
  const [winCelebrating, setWinCelebrating] = useState(null); // "O" or "X" during celebration
  const [clearedCells, setClearedCells] = useState(new Set()); // cells belonging to scored lines (greyed out)
  const prevWinnerRef = useRef(null); // track last detected winner to avoid re-counting

  // ─── Local turn management ───
  const isIntraTeam = !teamRoleProp;
  const [currentTurn, setCurrentTurn] = useState(0);
  // Role alternates every turn: O, X, O, X, … so odd-numbered groups play both sides fairly
  const currentRole = isIntraTeam ? (currentTurn % 2 === 0 ? "O" : "X") : (teamRoleProp || "O");

  // Keep local board in sync from socket/parent updates
  useEffect(() => {
    if (Array.isArray(task?.board) && task.board.length === CELLS) {
      setBoard(task.board);
    }
  }, [task?.board]);

  const roleLabel = currentRole === "X" ? "FALSE" : "TRUE";
  const roleColor = currentRole === "X" ? "Red" : "Blue";
  const roleCls = currentRole === "X" ? "text-red-600" : "text-blue-600";

  const names = useMemo(() => {
    const raw =
      Array.isArray(task?.playerNames) ? task.playerNames :
      Array.isArray(task?.players) ? task.players.map((p) => p?.name || p?.displayName || p).filter(Boolean) :
      Array.isArray(task?.config?.players) ? task.config.players :
      Array.isArray(memberNames) && memberNames.length ? memberNames :
      null;
    const base = Array.isArray(raw) && raw.length
      ? raw.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    return base.length ? base : ["Player 1", "Player 2"];
  }, [task?.playerNames, task?.players, task?.config?.players, memberNames]);

  const activePlayerIndex = isIntraTeam
    ? (currentTurn % Math.max(names.length, 2))
    : (
        Number.isFinite(Number(task?.activePlayerIndex)) ? Number(task.activePlayerIndex) :
        Number.isFinite(Number(task?.turnIndex)) ? Number(task.turnIndex) :
        0
      );

  const activeName = names[activePlayerIndex] || `Player ${activePlayerIndex + 1}`;

  // ─── Drop a piece into a column ───
  const dropInColumn = useCallback(
    (statement, col) => {
      if (!statement || disabled) return;
      const row = lowestEmptyRow(board, col);
      if (row < 0) return; // column full

      const cellIdx = idx(row, col);
      // Statement truth determines the piece: true → O (Blue), false → X (Red)
      const placedRole = statement.isFalse ? "X" : "O";

      const newBoard = [...board];
      newBoard[cellIdx] = placedRole;
      setBoard(newBoard);
      setLastDrop({ index: cellIdx, role: placedRole });
      setTimeout(() => setLastDrop(null), 600);

      socket?.emit("connect-four-move", {
        roomCode: task.roomCode,
        col,
        teamRole: placedRole,
      });

      setUsedStatementIds((prev) => new Set(prev).add(statement.id));
      setActiveStatement(null);

      // Advance turn in intra-team mode
      if (isIntraTeam) {
        setCurrentTurn((prev) => (prev + 1) % Math.max(names.length, 2));
      }
    },
    [board, disabled, currentRole, isIntraTeam, names.length, socket, task.roomCode],
  );

  // ─── Detect new 4-in-a-row wins (multi-win: game keeps going) ───
  const { winner: latestWinner, line: latestWinLine } = calculateWinner(board);
  const boardFull = board.every((c) => c !== null);
  const statementsRemaining = useMemo(() => {
    const raw = Array.isArray(task?.statements)
      ? task.statements
      : Array.isArray(task?.items)
        ? task.items
        : Array.isArray(task?.config?.statements)
          ? task.config.statements
          : [];
    return raw.filter((s) => s && !usedStatementIds.has(String(s.id || s._id || ""))).length;
  }, [task?.statements, task?.items, task?.config?.statements, usedStatementIds]);

  // Round is over when board fills OR statements run out — but game continues via restart
  const roundOver = boardFull || (statementsRemaining === 0 && !activeStatement);
  // True game-over only when the parent timer expires (disabled=true) while a round is over
  const gameOver = disabled && roundOver;
  const inputDisabled = disabled || !!winCelebrating || roundOver;

  // ─── Column click (tap-to-place after selecting a statement) ───
  const handleColumnClick = (col) => {
    if (inputDisabled) return;
    if (!activeStatement) {
      setHintPulse(true);
      setTimeout(() => setHintPulse(false), 1200);
      return;
    }
    dropInColumn(activeStatement, col);
  };

  // ─── Statement selection ───
  const handleStatementClick = (statement) => {
    if (inputDisabled) return;
    setActiveStatement(statement);
    setHintPulse(true);
    setTimeout(() => setHintPulse(false), 1200);
  };

  // ─── Touch drag support ───
  const touchStatementRef = useRef(null);
  const colHeaderRefs = useRef([]);

  const handleTouchStart = (e, statement) => {
    if (inputDisabled) return;
    touchStatementRef.current = statement;
    setActiveStatement(statement);
  };

  const handleTouchEnd = (e) => {
    if (inputDisabled || !touchStatementRef.current) return;
    const touch = e.changedTouches?.[0];
    if (!touch) { touchStatementRef.current = null; return; }

    for (let c = 0; c < COLS; c++) {
      const el = colHeaderRefs.current[c];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
          touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        dropInColumn(touchStatementRef.current, c);
        touchStatementRef.current = null;
        return;
      }
    }
    touchStatementRef.current = null;
  };

  // ─── Desktop drag ───
  const handleDragStart = (e, statement) => {
    if (inputDisabled) return;
    setActiveStatement(statement);
    e.dataTransfer.setData("text/plain", JSON.stringify(statement));
  };

  const handleDrop = (e, col) => {
    e.preventDefault();
    if (inputDisabled) return;
    let stmt = activeStatement;
    try { stmt = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
    dropInColumn(stmt, col);
  };

  const allowDrop = (e) => e.preventDefault();

  // When a new win is detected, celebrate briefly, tally it, then mark cells as scored
  useEffect(() => {
    if (!latestWinner || !latestWinLine) return;
    // Deduplicate: don't re-celebrate the same line
    const lineKey = latestWinLine.join(",");
    if (prevWinnerRef.current === lineKey) return;
    prevWinnerRef.current = lineKey;

    // Show celebration
    setCurrentWinLine(latestWinLine);
    setWinCelebrating(latestWinner);
    setWins((prev) => ({ ...prev, [latestWinner]: (prev[latestWinner] || 0) + 1 }));

    try { new Audio("/sounds/victory.mp3").play(); } catch {}

    // After 2s, grey out the winning cells and continue play
    const timer = setTimeout(() => {
      setClearedCells((prev) => {
        const next = new Set(prev);
        latestWinLine.forEach((i) => next.add(i));
        return next;
      });
      // Clear the winning cells from the board so calculateWinner won't re-detect them
      setBoard((prev) => {
        const next = [...prev];
        latestWinLine.forEach((i) => { next[i] = null; });
        return next;
      });
      setCurrentWinLine(null);
      setWinCelebrating(null);
      prevWinnerRef.current = null;
    }, 2000);
    return () => clearTimeout(timer);
  }, [latestWinner, latestWinLine]);

  // ─── Restart: clear board + re-enable all statements for a new round ───
  const handleRestart = useCallback(() => {
    setBoard(Array(CELLS).fill(null));
    setUsedStatementIds(new Set());
    setActiveStatement(null);
    setClearedCells(new Set());
    setCurrentWinLine(null);
    setWinCelebrating(null);
    prevWinnerRef.current = null;
    setDroppingCol(null);
    setLastDrop(null);
    setRoundNumber((prev) => prev + 1);
    if (isIntraTeam) setCurrentTurn(0);
  }, [isIntraTeam]);

  // ─── Submit final score when game ends (timer expired) ───
  useEffect(() => {
    if (hasSubmittedRef.current) return;
    if (!gameOver) return;

    hasSubmittedRef.current = true;

    // ── Scoring constants ──
    const POINTS_PER_WIN = 75;   // per win earned by that side's players
    const PARTICIPATION = 20;    // everyone gets this
    const SPEED_BONUS_MAX = 75;

    const speedBonus =
      timeLimitSeconds > 0 && remainingMs > 0
        ? Math.round((remainingMs / (timeLimitSeconds * 1000)) * SPEED_BONUS_MAX)
        : 0;

    const oCount = board.filter((c) => c === "O").length;
    const xCount = board.filter((c) => c === "X").length;
    const totalWins = wins.O + wins.X;
    const overallWinner = wins.O > wins.X ? "O" : wins.X > wins.O ? "X" : null;

    // Per-player: each player earns POINTS_PER_WIN × their side's win count + participation + speed
    const playerScores = names.map((name, i) => {
      const role = i === 0 ? "O" : "X";
      const myWins = wins[role] || 0;
      const winPts = myWins * POINTS_PER_WIN;
      const total = winPts + PARTICIPATION + speedBonus;
      return {
        name,
        role,
        roleLabel: role === "O" ? "TRUE (Blue)" : "FALSE (Red)",
        wins: myWins,
        isOverallWinner: overallWinner === role,
        breakdown: { wins: myWins, winPoints: winPts, participation: PARTICIPATION, speedBonus },
        points: total,
      };
    });

    const teamPointsEarned = playerScores.reduce((sum, p) => sum + p.points, 0);

    onSubmit?.({
      type: "true-false-connect-four",
      taskType: "true-false-connect-four",
      gameComplete: true,
      completed: true,
      winner: overallWinner || "draw",
      winnerLabel: overallWinner === "O" ? "TRUE (Blue)" : overallWinner === "X" ? "FALSE (Red)" : "Draw",
      winnerPlayer: overallWinner
        ? (overallWinner === "O" ? names[0] : names[1] || "Player 2")
        : null,
      winTally: { O: wins.O, X: wins.X },
      totalWins,
      board: [...board],
      movesPlayed: board.filter((c) => c !== null).length + clearedCells.size,
      oCount,
      xCount,
      players: names,
      playerScores,
      pointsEarned: teamPointsEarned,
      teamPointsEarned,
      speedBonus,
      roundsPlayed: roundNumber,
      submittedAt: new Date().toISOString(),
    });
  }, [gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Statements pool ───
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
          .map((s, i) => {
            if (!s) return null;
            if (typeof s === "string") return { text: s, isFalse: false, id: `s${i}` };
            const text = String(s.text || s.prompt || s.statement || "").trim();
            if (!text) return null;
            const isFalse =
              typeof s.isFalse === "boolean" ? s.isFalse :
              typeof s.correct === "boolean" ? !s.correct :
              typeof s.correctAnswer === "boolean" ? !s.correctAnswer :
              typeof s.answer === "boolean" ? !s.answer :
              typeof s.answer === "string" ? String(s.answer).toLowerCase() === "false" :
              false;
            return { text, isFalse, id: String(s.id || s._id || `s${i}`) };
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

  const instructions = gameOver
    ? "Time's up! Great game!"
    : roundOver
      ? `Round ${roundNumber} complete! Tap "Play Again" to start a new round.`
      : "Pick a statement below, then tap a column to drop your piece. " +
        "TRUE statements always go Blue (O), FALSE statements always go Red (X). " +
        `Each 4-in-a-row scores points — play as many rounds as you can! (Round ${roundNumber})`;

  return (
    <div
      className="flex flex-col items-center justify-center h-full p-4"
      style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(14,165,233,0.10))",
        borderRadius: 18,
      }}
    >
      <h2 className="text-3xl font-bold mb-3 text-indigo-700">
        TRUE/FALSE CONNECT FOUR!
      </h2>

      {/* Player info */}
      <div className="w-full max-w-4xl mb-4">
        <div className="rounded-2xl p-3 shadow-sm border border-slate-200 bg-white/80">
          <div className="text-xl">
            <span className="font-extrabold">{activeName}</span>{" "}
            <span className="text-slate-500">is playing</span>{" "}
            <span className={`font-extrabold ${roleCls}`}>{roleLabel} ({roleColor})</span>
          </div>
          <div className="mt-1 text-slate-700 text-sm leading-relaxed">{instructions}</div>
        </div>
      </div>

      {/* Hints */}
      {activeStatement && (
        <div className="mb-2 px-4 py-2 bg-indigo-100 border-2 border-indigo-400 rounded-xl text-indigo-800 font-bold text-center text-base animate-pulse">
          Now tap a column to drop your piece!
        </div>
      )}
      {!activeStatement && hintPulse && (
        <div className="mb-2 px-4 py-2 bg-yellow-100 border-2 border-yellow-400 rounded-xl text-yellow-800 font-bold text-center text-base animate-pulse">
          Pick a statement bubble first!
        </div>
      )}

      {/* ─── CONNECT FOUR GRID ─── */}
      <div
        className="mb-6 rounded-2xl overflow-hidden shadow-lg border-4 border-indigo-600"
        style={{ background: "#1e3a8a" }}
      >
        {/* Column drop targets (arrows) */}
        <div className="grid gap-1 px-2 pt-2" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {Array.from({ length: COLS }).map((_, c) => {
            const isFull = lowestEmptyRow(board, c) < 0;
            const canDrop = activeStatement && !isFull && !inputDisabled;
            return (
              <div
                key={`header-${c}`}
                ref={(el) => { colHeaderRefs.current[c] = el; }}
                onClick={() => handleColumnClick(c)}
                onDrop={(e) => handleDrop(e, c)}
                onDragOver={allowDrop}
                onMouseEnter={() => !inputDisabled && setDroppingCol(c)}
                onMouseLeave={() => setDroppingCol(null)}
                className={[
                  "flex items-center justify-center h-10 rounded-t-lg text-2xl font-bold transition-all duration-200 select-none",
                  canDrop
                    ? "cursor-pointer text-yellow-300 hover:text-yellow-100 hover:bg-indigo-500/40"
                    : isFull
                      ? "text-indigo-800/30 cursor-not-allowed"
                      : "text-indigo-400/50 cursor-pointer",
                ].join(" ")}
              >
                {canDrop ? "▼" : isFull ? "•" : "▽"}
              </div>
            );
          })}
        </div>

        {/* Grid cells */}
        <div className="relative">
          {currentWinLine && (
            <WinLine cells={currentWinLine} cols={COLS} totalRows={ROWS} />
          )}
        <div
          className="grid gap-1 p-2"
          style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        >
          {Array.from({ length: ROWS }).map((_, r) =>
            Array.from({ length: COLS }).map((_, c) => {
              const i = idx(r, c);
              const cell = board[i];
              const isLastDrop = lastDrop?.index === i;
              const isHoveredCol = droppingCol === c && !cell;
              const previewRow = droppingCol !== null ? lowestEmptyRow(board, droppingCol) : -1;
              const isPreview = isHoveredCol && r === previewRow && activeStatement;

              return (
                <div
                  key={i}
                  onClick={() => handleColumnClick(c)}
                  className={[
                    "w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-2xl font-bold transition-all duration-200",
                    cell === "X"
                      ? "bg-red-500 border-2 border-red-300 shadow-inner"
                      : cell === "O"
                        ? "bg-blue-500 border-2 border-blue-300 shadow-inner"
                        : isPreview
                          ? currentRole === "X"
                            ? "bg-red-200/50 border-2 border-red-300/50"
                            : "bg-blue-200/50 border-2 border-blue-300/50"
                          : "bg-white border-2 border-indigo-200",
                    isLastDrop ? "scale-110" : "",
                  ].join(" ")}
                  style={
                    cell === "X" ? { boxShadow: "inset 0 2px 6px rgba(0,0,0,0.3), 0 0 8px rgba(239,68,68,0.4)" } :
                    cell === "O" ? { boxShadow: "inset 0 2px 6px rgba(0,0,0,0.3), 0 0 8px rgba(59,130,246,0.4)" } :
                    {}
                  }
                >
                  {cell === "X" && <span className="text-white drop-shadow-md">X</span>}
                  {cell === "O" && <span className="text-white drop-shadow-md">O</span>}
                </div>
              );
            }),
          )}
        </div>
        </div>{/* close relative wrapper */}
      </div>

      {/* ─── STATEMENT CARDS ─── */}
      <div className="space-y-3 w-full max-w-lg overflow-y-auto" style={{ maxHeight: "35vh" }}>
        <p
          className={[
            "text-base font-semibold text-center transition-colors duration-300",
            !activeStatement && hintPulse ? "text-yellow-600" : "text-slate-700",
          ].join(" ")}
        >
          Tap a statement, then tap a column to drop it.
        </p>
        {statements.filter((stmt) => !usedStatementIds.has(stmt.id)).map((stmt, i) => {
          const isActive = activeStatement && activeStatement.id === stmt.id;
          return (
            <div
              key={stmt.id || i}
              draggable={!inputDisabled}
              onDragStart={(e) => handleDragStart(e, stmt)}
              onTouchStart={(e) => handleTouchStart(e, stmt)}
              onTouchEnd={handleTouchEnd}
              onClick={() => handleStatementClick(stmt)}
              className={[
                "p-3 rounded-lg text-base font-medium text-center transition-all duration-200 cursor-pointer select-none",
                "bg-amber-50 border-2 border-amber-400",
                inputDisabled ? "opacity-50" : "hover:scale-105 active:scale-95",
                isActive ? "ring-4 ring-indigo-500 scale-105 shadow-lg" : "",
              ].join(" ")}
            >
              {stmt.text}
            </div>
          );
        })}
      </div>

      {/* WIN TALLY (always visible once any win has occurred) */}
      {(wins.O > 0 || wins.X > 0) && (
        <div className="mt-3 flex items-center justify-center gap-6 text-lg font-bold">
          <span className="text-blue-600">Blue (TRUE): {wins.O}</span>
          <span className="text-slate-400">—</span>
          <span className="text-red-600">Red (FALSE): {wins.X}</span>
        </div>
      )}

      {/* MID-GAME WIN CELEBRATION (brief flash, then play continues) */}
      {winCelebrating && !gameOver && (
        <div className="mt-4 text-center animate-bounce">
          <div className="text-3xl font-bold">
            {winCelebrating === "O" ? (
              <span className="text-blue-400 drop-shadow-lg">4 in a row! TRUE scores!</span>
            ) : (
              <span className="text-red-400 drop-shadow-lg">4 in a row! FALSE scores!</span>
            )}
          </div>
          <div className="text-base mt-1 text-slate-600 font-medium">Keep playing for more points!</div>
        </div>
      )}

      {/* ROUND OVER — Play Again */}
      {roundOver && !gameOver && (
        <div className="mt-6 text-center">
          <div className="text-2xl font-bold text-indigo-700 mb-3">
            Round {roundNumber} complete!
          </div>
          <button
            onClick={handleRestart}
            className="px-8 py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-2xl font-extrabold rounded-2xl shadow-lg hover:scale-105 active:scale-95 transition-all duration-200 animate-pulse"
          >
            Play Again!
          </button>
          <div className="text-base mt-2 text-slate-600">Keep playing to earn more points!</div>
        </div>
      )}

      {/* GAME OVER (timer expired) */}
      {gameOver && (
        <div className="mt-6 text-center">
          <div className="text-4xl font-bold animate-pulse">
            {wins.O > wins.X ? (
              <span className="text-blue-400 drop-shadow-lg">TRUE (Blue) wins overall!</span>
            ) : wins.X > wins.O ? (
              <span className="text-red-400 drop-shadow-lg">FALSE (Red) wins overall!</span>
            ) : (
              <span className="text-purple-400 drop-shadow-lg">It&apos;s a tie!</span>
            )}
          </div>
          <div className="text-lg mt-2 text-slate-600 font-semibold">
            Final: Blue {wins.O} — Red {wins.X} ({roundNumber} round{roundNumber > 1 ? "s" : ""} played)
          </div>
          {isIntraTeam && wins.O !== wins.X && (
            <div className="text-xl mt-2 font-semibold text-slate-700">
              {wins.O > wins.X ? names[0] : names[1] || "Player 2"} takes the game!
            </div>
          )}
        </div>
      )}
    </div>
  );
}
