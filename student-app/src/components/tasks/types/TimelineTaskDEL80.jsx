//student-app/src/components/tasks/types/TimelineTask.jsx
import React, { useState, useEffect } from "react";

export default function TimelineTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [items, setItems] = useState(task.shuffledItems || []);
  const [winner, setWinner] = useState(task.winner);

  const correctOrder = task.correctOrder || [];

  useEffect(() => {
    if (task.winner) {
      if (task.winner === "current") {
        new Audio("/sounds/victory.mp3").play();
      } else {
        new Audio("/sounds/lose.mp3").play();
      }
      setWinner(task.winner);
    }
  }, [task.winner]);

  const handleDragStart = (e, index) => {
    e.dataTransfer.setData("index", index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const dragIndex = Number(e.dataTransfer.getData("index"));
    if (dragIndex === dropIndex) return;

    const newItems = [...items];
    const [moved] = newItems.splice(dragIndex, 1);
    newItems.splice(dropIndex, 0, moved);
    setItems(newItems);

    // Check if correct
    const isCorrect = newItems.every((item, i) => item.id === correctOrder[i]);
    if (isCorrect) {
      socket.emit("timeline-complete", { roomCode: task.roomCode });
    }
  };

  const allowDrop = (e) => e.preventDefault();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <h2 className="text-5xl font-bold mb-6 text-indigo-700">
        TIMELINE – DRAG TO ORDER
      </h2>
      <p className="text-2xl mb-10 text-center max-w-4xl">
        {task.instructions || "Put these events in the correct order!"}
      </p>

      <div className="space-y-6 w-full max-w-3xl">
        {items.map((item, index) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragOver={allowDrop}
            className="bg-white border-4 border-indigo-600 rounded-2xl p-8 text-3xl font-bold text-center cursor-move shadow-lg hover:shadow-2xl transition-all hover:scale-105"
          >
            {item.text}
          </div>
        ))}
      </div>

      {winner && (
        <div className="mt-12 text-7xl font-bold animate-bounce">
          {winner === "current" ? (
            <span className="text-green-600">YOU WIN! +15</span>
          ) : (
            <span className="text-red-600">FINISHED!</span>
          )}
        </div>
      )}
    </div>
  );
}