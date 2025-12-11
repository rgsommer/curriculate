import React, { useState, useEffect } from "react";
import VictoryScreen from "../../VictoryScreen";

export default function TrueFalseTicTacToeTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamRole,
}) {
  const [board, setBoard] = useState(task.board || Array(9).fill(null));
  const [draggedStatement, setDraggedStatement] = useState(null);
  const [activeStatement, setActiveStatement] = useState(null); // tap-to-place
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

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <h2 className="text-4xl font-bold mb-4 text-indigo-700">
        TRUE/FALSE TIC-TAC-TOE BATTLE!
      </h2>
      <p className="text-2xl mb-6">
        You are{" "}
        <strong>{teamRole === "X" ? "FALSE" : "TRUE"}</strong> ({teamRole})
      </p>

      {/* TIC-TAC-TOE GRID */}
      <div className="grid grid-cols-3 gap-4 mb-8 bg-gray-200 p-6 rounded-2xl">
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
        <p className="text-xl font-semibold text-center">
          Drag or tap a statement, then drop/tap it on a square!
        </p>
        {(task.statements || []).map((stmt, i) => {
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
