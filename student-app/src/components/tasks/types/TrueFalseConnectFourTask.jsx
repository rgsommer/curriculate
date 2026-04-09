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
 * Check for 4-in-a-row. Returns "X", "O", or null.
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
        let count = 1;
        for (let step = 1; step < 4; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[idx(nr, nc)] !== val) break;
          count++;
        }
        if (count >= 4) return val;
      }
    }
  }
  return null;
}

export default function TrueFalseConnectFourTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamRole,
  memberNames = [],
}) {
  const [board, setBoard] = useState(task.board || Array(CELLS).fill(null));
  const [activeStatement, setActiveStatement] = useState(null);
  const [hintPulse, setHintPulse] = useState(false);
  const [droppingCol, setDroppingCol] = useState(null); // animate column highlight
  const [lastDrop, setLastDrop] = useState(null); // { index, role } for drop animation

  // Keep local board in sync from socket/parent updates
  useEffect(() => {
    if (Array.isArray(task?.board) && task.board.length === CELLS) {
      setBoard(task.board);
    }
  }, [task?.board]);

  const roleLabel = teamRole === "X" ? "FALSE" : "TRUE";
  const roleColor = teamRole === "X" ? "Red" : "Blue";
  const roleCls = teamRole === "X" ? "text-red-600" : "text-blue-600";

  const activePlayerIndex =
    Number.isFinite(Number(task?.activePlayerIndex)) ? Number(task.activePlayerIndex) :
    Number.isFinite(Number(task?.turnIndex)) ? Number(task.turnIndex) :
    Number.isFinite(Number(task?.currentPlayerIndex)) ? Number(task.currentPlayerIndex) :
    0;

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

  const activeName = names[activePlayerIndex] || `Player ${activePlayerIndex + 1}`;
  const [showVictory, setShowVictory] = useState(false);

  useEffect(() => {
    if (task.winner) {
      if (task.winner === teamRole) {
        try { new Audio("/sounds/victory.mp3").play(); } catch {}
        setShowVictory(true);
        setTimeout(() => setShowVictory(false), 5000);
      } else {
        try { new Audio("/sounds/lose.mp3").play(); } catch {}
      }
    }
  }, [task.winner, teamRole]);

  // ─── Drop a piece into a column ───
  const dropInColumn = useCallback(
    (statement, col) => {
      if (!statement || disabled) return;
      const row = lowestEmptyRow(board, col);
      if (row < 0) return; // column full

      const cellIdx = idx(row, col);
      const isFalse = statement.isFalse;
      const shouldBeFalse = teamRole === "X";
      const matchesRole = (shouldBeFalse && isFalse) || (!shouldBeFalse && !isFalse);
      const placedRole = matchesRole ? teamRole : (teamRole === "X" ? "O" : "X");

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

      setActiveStatement(null);
    },
    [board, disabled, teamRole, socket, task.roomCode],
  );

  // ─── Column click (tap-to-place after selecting a statement) ───
  const handleColumnClick = (col) => {
    if (disabled) return;
    if (!activeStatement) {
      setHintPulse(true);
      setTimeout(() => setHintPulse(false), 1200);
      return;
    }
    dropInColumn(activeStatement, col);
  };

  // ─── Statement selection ───
  const handleStatementClick = (statement) => {
    if (disabled) return;
    setActiveStatement(statement);
    setHintPulse(true);
    setTimeout(() => setHintPulse(false), 1200);
  };

  // ─── Touch drag support ───
  const touchStatementRef = useRef(null);
  const colHeaderRefs = useRef([]);

  const handleTouchStart = (e, statement) => {
    if (disabled) return;
    touchStatementRef.current = statement;
    setActiveStatement(statement);
  };

  const handleTouchEnd = (e) => {
    if (disabled || !touchStatementRef.current) return;
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
    if (disabled) return;
    setActiveStatement(statement);
    e.dataTransfer.setData("text/plain", JSON.stringify(statement));
  };

  const handleDrop = (e, col) => {
    e.preventDefault();
    if (disabled) return;
    let stmt = activeStatement;
    try { stmt = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
    dropInColumn(stmt, col);
  };

  const allowDrop = (e) => e.preventDefault();

  const winner = calculateWinner(board);

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

  const instructions =
    "Pick a statement below, then tap a column to drop your piece. " +
    `If the statement matches your role (${roleLabel}), you claim the slot in ${roleColor}! ` +
    "First to get 4 in a row wins.";

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
            const canDrop = activeStatement && !isFull && !disabled;
            return (
              <div
                key={`header-${c}`}
                ref={(el) => { colHeaderRefs.current[c] = el; }}
                onClick={() => handleColumnClick(c)}
                onDrop={(e) => handleDrop(e, c)}
                onDragOver={allowDrop}
                onMouseEnter={() => !disabled && setDroppingCol(c)}
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
                          ? teamRole === "X"
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
        {statements.map((stmt, i) => {
          const isActive = activeStatement && activeStatement.id === stmt.id;
          return (
            <div
              key={stmt.id || i}
              draggable={!disabled}
              onDragStart={(e) => handleDragStart(e, stmt)}
              onTouchStart={(e) => handleTouchStart(e, stmt)}
              onTouchEnd={handleTouchEnd}
              onClick={() => handleStatementClick(stmt)}
              className={[
                "p-3 rounded-lg text-base font-medium text-center transition-all duration-200 cursor-pointer select-none",
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
        <div className="mt-6 text-5xl font-bold animate-pulse">
          {winner === teamRole ? (
            <span className="text-green-400 drop-shadow-lg">YOU WIN! +10</span>
          ) : (
            <span className="text-red-400 drop-shadow-lg">YOU LOSE!</span>
          )}
        </div>
      )}

      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}
