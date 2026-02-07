import React, { useEffect, useMemo, useState } from "react";
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
  const [draggedStatement, setDraggedStatement] = useState(null);
  const [activeStatement, setActiveStatement] = useState(null); // tap-to-place

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

    // You could call onSubmit here if you want to log each move:
    // onSubmit?.({ board: newBoard });
  };

  // Desktop drag start
  const handleDragStart = (e, statement) => {
    if (disabled) return;
    setDraggedStatement(statement);
    setActiveStatement(statement);
  };

  // Desktop drop target
  const handleDrop = (e, index) => {
    e.preventDefault();
    if (disabled) return;
    applyMove(draggedStatement, index);
    setDraggedStatement(null);
    setActiveStatement(null);
  };

  const allowDrop = (e) => e.preventDefault();

  // Touch / click: tap statement to select, then tap a cell to place it
  const handleStatementClick = (statement) => {
    if (disabled) return;
    setActiveStatement(statement);
  };

  const handleCellClick = (index) => {
    if (disabled) return;
    applyMove(activeStatement, index);
    setActiveStatement(null);
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
              // If all we have is text, default to "true" (isFalse=false) so it doesn't crash.
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
    "How to play: Pick a statement bubble. Drag it to an empty square (or tap the bubble, then tap a square). " +
    `If the statement matches your role (${roleLabel}), you claim the square. If not, the other team claims it. ` +
    "First team to get 3 in a row wins.";

  return (
    <div className="flex flex-col items-center justify-center h-full p-6" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(14,165,233,0.10))", borderRadius: 18 }}>
      <h2 className="text-4xl font-bold mb-4 text-indigo-700">
        TRUE/FALSE TIC-TAC-TOE BATTLE!
      </h2>
      <div className="w-full max-w-3xl mb-6">
        <div className="rounded-2xl p-4 shadow-sm border border-slate-200 bg-white/80">
          <div className="text-2xl">
            <span className="font-extrabold">Player {activePlayerIndex + 1}</span>{" "}
            <span className="text-slate-600">({activeName})</span>{" "}
            <span className="text-slate-500">is playing</span>{" "}
            <span className="font-extrabold text-indigo-700">{roleLabel}</span>
          </div>
          <div className="mt-2 text-slate-700 text-base leading-relaxed">
            <div className="font-semibold mb-1">Instructions</div>
            <div className="text-slate-700">{instructions}</div>
          </div>
        </div>
      </div>

      {/* TIC-TAC-TOE GRID */}
      <div className="grid grid-cols-3 gap-4 mb-8 bg-white/80 p-6 rounded-2xl border border-slate-200 shadow-md">
        {board.map((cell, i) => (
          <div
            key={i}
            onDrop={(e) => handleDrop(e, i)}
            onDragOver={allowDrop}
            onClick={() => handleCellClick(i)} // tap-to-place
            className="w-24 h-24 bg-white border-4 border-gray-400 rounded-xl flex items-center justify-center text-6xl font-bold cursor-pointer"
          >
            {cell}
          </div>
        ))}
      </div>

      {/* STATEMENT CARDS */}
      <div className="space-y-4 w-full max-w-md">
        <p className="text-lg font-semibold text-center text-slate-700">
          Choose a statement bubble below. Drag it onto the grid (or tap bubble, then tap a square).
        </p>
        {statements.map((stmt, i) => {
          const isActive =
            activeStatement && activeStatement.text === stmt.text;
          return (
            <div
              key={i}
              draggable={!disabled}
              onDragStart={(e) => handleDragStart(e, stmt)}
              onClick={() => handleStatementClick(stmt)}
              className={`p-4 rounded-lg text-lg font-medium text-center transition cursor-pointer
                ${stmt.isFalse ? "bg-red-100 border-2 border-red-400" : "bg-green-100 border-2 border-green-400"}
                ${disabled ? "opacity-50" : "hover:scale-105"}
                ${isActive ? "ring-4 ring-indigo-500" : ""}
              `}
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
