// student-app/src/components/tasks/types/TimelineTask.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * Timeline – Drag to Order (solo / non-collab)
 *
 * Expected task shape (preferred):
 *  - shuffledItems: [{ id, label, date?, description? }] OR [string]
 *  - correctOrder:  [id1, id2, ...] (or matching string values if using strings)
 *
 * Submission payload:
 *  - { order: [id1, id2, ...] }  (or string values if items are strings)
 */
export default function TimelineTask({ task, onSubmit, disabled, socket }) {
  // socket is accepted for compatibility with TaskRunner but is not used for solo timeline play.
  void socket;

  const normalized = useMemo(() => {
    const raw =
      (Array.isArray(task?.shuffledItems) && task.shuffledItems) ||
      (Array.isArray(task?.config?.items) && task.config.items) ||
      (Array.isArray(task?.items) && task.items) ||
      [];

    return raw
      .filter(Boolean)
      .map((it, idx) => {
        if (typeof it === "string") {
          const v = it.trim();
          return {
            id: `item-${idx}-${v}`.slice(0, 80),
            label: v,
            date: null,
            description: null,
            isString: true,
            original: v,
          };
        }
        const id = String(it.id ?? it._id ?? `item-${idx}`).slice(0, 80);
        const label = String(it.label ?? it.text ?? it.title ?? `Item ${idx + 1}`).trim();
        const date = it.date ?? it.year ?? it.when ?? null;
        const description = it.description ?? it.details ?? null;
        return { id, label, date, description, isString: false, original: it };
      });
  }, [task]);

  const [items, setItems] = useState(normalized);
  const [winner, setWinner] = useState(task?.winner ?? null);

  const correctOrder = useMemo(() => task?.correctOrder || [], [task]);

  useEffect(() => {
    setItems(normalized);
    setWinner(task?.winner ?? null);
  }, [normalized, task?.winner]);

  const move = (from, delta) => {
    setItems((prev) => {
      const to = from + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return next;
    });
  };

  const handleSubmit = () => {
    if (disabled) return;

    // Prefer ids; if the task was authored as strings, submit the original strings
    const order = items.map((it) => (it.isString ? it.original : it.id));
    onSubmit?.({ order });
  };

  const canSubmit = !disabled && items.length >= 2;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{task?.title || "Timeline"}</h2>
          {task?.prompt ? <p className="mt-2 opacity-80">{task.prompt}</p> : null}
        </div>

        <button
          className={\`px-4 py-2 rounded font-semibold \${canSubmit ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-500"}\`}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          Submit
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {items.map((it, idx) => (
          <div
            key={it.id}
            className="flex items-stretch gap-3 border rounded-xl p-3 bg-white shadow-sm"
          >
            <div className="flex flex-col justify-center items-center w-12 rounded-lg bg-gray-100 text-gray-700 font-bold">
              {idx + 1}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">
                {it.date ? (
                  <span className="mr-2 inline-flex items-center px-2 py-0.5 text-xs rounded bg-gray-100">
                    {String(it.date)}
                  </span>
                ) : null}
                <span>{it.label}</span>
              </div>
              {it.description ? (
                <div className="mt-1 text-sm opacity-80 line-clamp-2">{it.description}</div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <button
                className="border rounded px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                onClick={() => move(idx, -1)}
                disabled={disabled || idx === 0}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                className="border rounded px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                onClick={() => move(idx, 1)}
                disabled={disabled || idx === items.length - 1}
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Optional “winner” banner (kept for backward compatibility if older tasks include it) */}
      {winner && (
        <div className="mt-10 text-5xl font-bold animate-bounce text-center">
          {winner === "current" ? (
            <span className="text-green-600">YOU WIN! +15</span>
          ) : (
            <span className="text-red-600">FINISHED!</span>
          )}
        </div>
      )}

      {/* Optional teacher-facing hint in review-only tasks */}
      {Array.isArray(correctOrder) && correctOrder.length > 0 ? null : null}
    </div>
  );
}
