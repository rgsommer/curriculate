import React, { useEffect, useMemo, useRef, useState } from "react";
import VictoryScreen from "../../VictoryScreen";

export default function TrueFalseTicTacToeTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamRole,
  memberNames = [],
}) {
  const [board, setBoard] = useState(task.board || Array(9).fill(null));
  const [activeStatement, setActiveStatement] = useState(null); // tap-to-place
  const [hintPulse, setHintPulse] = useState(false); // flash grid when statement selected

  // Keep local board in sync if parent/task updates it (e.g., from socket events).
  useEffect(() => {
    if (Array.isArray(task?.board) && task.board.length === 9) {
      setBoard(task.board);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.board]);

  const roleLabel = teamRole === "X" ? "FALSE" : "TRUE";
  const activePlayerIndex =
    Number.isFinite(Number(task?.activePlayerIndex)) ? Number(task.activePlayerIndex) :
    Number.isFinite(Number(task?.turnIndex)) ? Number(task.turnIndex) :
    Number.isFinite(Number(task?.currentPlayerIndex)) ? Number(task.currentPlayerIndex) :
    0;

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

  const activeName = names[activePlayerIndex] || `Player ${activePlayerIndex + 1}`;
  const [showVictory, setShowVictory] = useState(false);

  useEffect(() => {
    if (task.winner) {
      if (task.winner === teamRole) {
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
  }, [task.winner, teamRole]);

  // Core logic: given a statement + board index, apply the move
  const applyMove = (statement, index) => {
    if (!statement || disabled || board[index]) return;

    const isFalse = statement.isFalse;
    const shouldBeFalse = teamRole === "X";

    const newBoard = [...board];

    // If statement matches your role's truthiness, you place your mark.
    // Otherwise the other team gets the mark.
    if ((shouldBeFalse && isFalse) || (!shouldBeFalse && !isFalse)) {
      newBoard[index] = teamRole;
      setBoard(newBoard);
      socket?.emit("tictactoe-move", {
        roomCode: task.roomCode,
        index,
        teamRole,
      });
    } else {
      const otherRole = teamRole === "X" ? "O" : "X";
      newBoard[index] = otherRole;
      setBoard(newBoard);
      socket?.emit("tictactoe-move", {
        roomCode: task.roomCode,
        index,
        teamRole: otherRole,
      });
    }

    setActiveStatement(null);
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

  const winner = calculateWinner(board);

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
    `If the statement matches your role (${roleLabel}), you claim the square! ` +
    "First team to get 3 in a row wins.";

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
            <span className="font-extrabold text-indigo-700">{roleLabel}</span>
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
          "grid grid-cols-3 gap-4 mb-8 p-6 rounded-2xl border shadow-md transition-all duration-300",
          activeStatement
            ? "bg-indigo-50 border-indigo-300 shadow-indigo-200"
            : "bg-white/80 border-slate-200",
        ].join(" ")}
      >
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
                cell
                  ? "bg-white border-4 border-gray-400"
                  : canPlace
                    ? "bg-indigo-100 border-4 border-indigo-400 cursor-pointer hover:bg-indigo-200 hover:scale-105 active:scale-95"
                    : "bg-white border-4 border-gray-300 cursor-pointer",
                canPlace ? "animate-pulse" : "",
              ].join(" ")}
              style={canPlace ? { boxShadow: "0 0 12px rgba(99,102,241,0.4)" } : {}}
            >
              {cell === "X" && <span className="text-red-500">X</span>}
              {cell === "O" && <span className="text-blue-500">O</span>}
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
        {statements.map((stmt, i) => {
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
        <div className="mt-8 text-6xl font-bold animate-pulse">
          {winner === teamRole ? (
            <span className="text-green-600">YOU WIN! +10</span>
          ) : (
            <span className="text-red-600">YOU LOSE!</span>
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
  for (let line of lines) {
    if (
      board[line[0]] &&
      board[line[0]] === board[line[1]] &&
      board[line[0]] === board[line[2]]
    ) {
      return board[line[0]];
    }
  }
  return null;
}
