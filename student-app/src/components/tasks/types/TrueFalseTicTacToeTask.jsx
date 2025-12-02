// student-app/src/components/tasks/types/TrueFalseTicTacToeTask.jsx
import React, { useState, useEffect } from "react";
import VictoryScreen from "../VictoryScreen";

export default function TrueFalseTicTacToeTask({
  task,
  onSubmit,
  disabled,
  socket,
  teamRole,
}) {
  const [board, setBoard] = useState(task.board || Array(9).fill(null));
  const [draggedStatement, setDraggedStatement] = useState(null);
  const [showVictory, setShowVictory] = useState(false);

  useEffect(() => {
    if (task.winner) {
      if (task.winner === teamRole) {
        new Audio("/sounds/victory.mp3").play();
        setShowVictory(true);
        setTimeout(() => setShowVictory(false), 5000);
      } else {
        new Audio("/sounds/lose.mp3").play();
      }
    }
  }, [task.winner]);

  const handleDragStart = (e, statement) => {
    setDraggedStatement(statement);
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    if (disabled || board[index]) return;

    const isFalse = statement.isFalse;
    const shouldBeFalse = teamRole === "X";

    if ((shouldBeFalse && isFalse) || (!shouldBeFalse && !isFalse)) {
      const newBoard = [...board];
      newBoard[index] = teamRole;
      setBoard(newBoard);
      socket.emit("tictactoe-move", { roomCode: task.roomCode, index, teamRole });
    } else {
      const newBoard = [...board];
      newBoard[index] = teamRole === "X" ? "O" : "X";
      setBoard(newBoard);
      socket.emit("tictactoe-move", { roomCode: task.roomCode, index, teamRole: teamRole === "X" ? "O" : "X" });
    }
  };

  const allowDrop = (e) => e.preventDefault();

  const winner = calculateWinner(board);

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <h2 className="text-4xl font-bold mb-4 text-indigo-700">
        TRUE/FALSE TIC-TAC-TOE BATTLE!
      </h2>
      <p className="text-2xl mb-6">
        You are <strong>{teamRole === "X" ? "FALSE" : "TRUE"}</strong> ({teamRole})
      </p>

      <div className="grid grid-cols-3 gap-4 mb-8 bg-gray-200 p-6 rounded-2xl">
        {board.map((cell, i) => (
          <div
            key={i}
            onDrop={(e) => handleDrop(e, i)}
            onDragOver={allowDrop}
            className="w-24 h-24 bg-white border-4 border-gray-400 rounded-xl flex items-center justify-center text-6xl font-bold"
          >
            {cell}
          </div>
        ))}
      </div>

      <div className="space-y-4 w-full max-w-md">
        <p className="text-xl font-semibold text-center">
          Drag your statements to the grid!
        </p>
        {task.statements.map((stmt, i) => (
          <div
            key={i}
            draggable
            onDragStart={(e) => handleDragStart(e, stmt)}
            className={`p-4 rounded-lg cursor-move text-lg font-medium text-center transition
              ${stmt.isFalse ? "bg-red-100 border-2 border-red-400" : "bg-green-100 border-2 border-green-400"}
              ${disabled ? "opacity-50" : "hover:scale-105"}
            `}
          >
            {stmt.text}
          </div>
        ))}
      </div>

      {winner && (
        <div className="mt-8 text-6xl font-bold animate-pulse">
          {winner === teamRole ? (
            <span className="text-green-600">YOU WIN! +10</span>
          ) : (
            <span className="text-red-600">YOU LOSE!</span>
          )}
        </div>
      )}

      {showVictory && <VictoryScreen onClose={() => setShowVictory(false)} />}
    </div>
  );
}

function calculateWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (let line of lines) {
    if (board[line[0]] && board[line[0]] === board[line[1]] && board[line[0]] === board[line[2]]) {
      return board[line[0]];
    }
  }
  return null;
}