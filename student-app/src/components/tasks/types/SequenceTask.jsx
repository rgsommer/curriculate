// student-app/src/components/tasks/types/SequenceTask.jsx
import React, { useState } from "react";

export default function SequenceTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const [order, setOrder] = useState(
    (task.config?.items || []).map((_, idx) => idx)
  );

  const pushDraft = (nextOrder) => {
    if (onAnswerChange) {
      onAnswerChange({ order: nextOrder });
    }
  };

  const move = (fromIdx, direction) => {
    if (disabled) return;
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= order.length) return;
    const newOrder = [...order];
    const temp = newOrder[fromIdx];
    newOrder[fromIdx] = newOrder[toIdx];
    newOrder[toIdx] = temp;
    setOrder(newOrder);
    pushDraft(newOrder);
  };

  const handleSubmit = () => {
    onSubmit({ order });
  };

  return (
    <div className="p-4">
      <h2 className="font-bold text-xl mb-3">{task.prompt}</h2>
      <div className="space-y-2 mb-4">
        {order.map((itemIdx, idx) => (
          <div
            key={itemIdx}
            className="flex items-center justify-between border rounded px-3 py-2"
          >
            <span>{task.config.items[itemIdx].text}</span>
            <div className="flex gap-1">
              <button
                className="border rounded px-2 text-xs"
                onClick={() => move(idx, -1)}
                disabled={disabled || idx === 0}
              >
                ↑
              </button>
              <button
                className="border rounded px-2 text-xs"
                onClick={() => move(idx, 1)}
                disabled={disabled || idx === order.length - 1}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        className="w-full border rounded px-3 py-2 font-bold"
        onClick={handleSubmit}
        disabled={disabled}
      >
        Submit
      </button>
    </div>
  );
}
