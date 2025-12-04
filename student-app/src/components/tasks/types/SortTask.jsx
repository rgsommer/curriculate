// student-app/src/components/tasks/types/SortTask.jsx
import React, { useState } from "react";

export default function SortTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  // 🔹 Safe config defaults
  const config = task?.config || {};
  const buckets = Array.isArray(config.buckets) ? config.buckets : [];
  const items = Array.isArray(config.items) ? config.items : [];

  const [assignments, setAssignments] = useState(
    items.map((_, idx) => ({ itemIndex: idx, bucketIndex: null }))
  );

  const pushDraft = (nextAssignments) => {
    if (onAnswerChange) {
      onAnswerChange({ assignments: nextAssignments });
    }
  };

  const setBucket = (itemIndex, bucketIndex) => {
    if (disabled) return;
    setAssignments((prev) => {
      const next = prev.map((a) =>
        a.itemIndex === itemIndex ? { ...a, bucketIndex } : a
      );
      pushDraft(next);
      return next;
    });
  };

  const handleSubmit = () => {
    if (assignments.some((a) => a.bucketIndex === null)) return;
    onSubmit({ assignments });
  };

  // Optional: guard for misconfigured tasks so we don't render nonsense
  if (!buckets.length || !items.length) {
    return (
      <div className="p-4 text-sm text-gray-600">
        This sort task is not fully configured (missing buckets or items).
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="font-bold text-xl mb-3">{task.prompt}</h2>
      <div className="space-y-3 mb-4">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <span className="flex-1">{item.text}</span>
            <select
              className="border rounded px-2 py-1"
              disabled={disabled}
              value={
                assignments.find((a) => a.itemIndex === idx)?.bucketIndex ?? ""
              }
              onChange={(e) =>
                setBucket(
                  idx,
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
            >
              <option value="">Choose…</option>
              {buckets.map((b, bIdx) => (
                <option key={bIdx} value={bIdx}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <button
        className="w-full border rounded px-3 py-2 font-bold"
        onClick={handleSubmit}
        disabled={disabled || assignments.some((a) => a.bucketIndex === null)}
      >
        Submit
      </button>
    </div>
  );
}
