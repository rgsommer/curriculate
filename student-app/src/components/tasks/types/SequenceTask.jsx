// student-app/src/components/tasks/types/SequenceTask.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * Sequence / Timeline task
 * Supports items as:
 *  - string: "Treaty of Utrecht"
 *  - object: { id, text } or { id, title, date, description } etc.
 *
 * Submits: { order: [itemId1, itemId2, ...] }
 */

const pick = (obj, keys, fallback = null) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return fallback;
};

const makeStableId = (it, idx) => {
  const explicit = pick(it, ["id", "_id", "key", "value"]);
  if (explicit) return String(explicit);

  const textish = pick(it, ["text", "title", "label", "name", "event"]);
  if (textish) return `item-${idx}-${textish}`.slice(0, 80);

  return `item-${idx}`;
};

export default function SequenceTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
}) {
  const items = useMemo(() => {
    const raw =
      (Array.isArray(task?.config?.items) && task.config.items) ||
      (Array.isArray(task?.options) && task.options) ||
      [];

    // Defensive fallback: never allow a dead-end / empty task.
    // If the generator forgets items, create a small practice set.
    const safeRaw = Array.isArray(raw) ? raw : [];
    const finalRaw =
      safeRaw.length > 0
        ? safeRaw
        : [
            { title: "First", date: "Step 1" },
            { title: "Next", date: "Step 2" },
            { title: "Last", date: "Step 3" },
          ];

    return finalRaw
      .filter(Boolean)
      .map((it, idx) => {
        if (typeof it === "string") {
          return {
            id: `item-${idx}-${it}`.slice(0, 80),
            primary: it,
            secondary: null,
            raw: { text: it },
          };
        }

        const id = makeStableId(it, idx);

        // Primary line (what students see most prominently)
        const primary =
          pick(it, ["primary", "title", "label", "text", "name", "event"], "") ||
          `Item ${idx + 1}`;

        // Secondary line (timeline-friendly)
        const secondary = pick(it, ["secondary", "date", "year", "time", "when"]);

        const description = pick(it, ["description", "details", "note"]);
        const imageUrl = pick(it, ["imageUrl", "image", "img", "thumbnail"]);

        return {
          id,
          primary,
          secondary,
          description,
          imageUrl,
          raw: it,
        };
      });
  }, [task]);

  const [orderIds, setOrderIds] = useState(() => items.map((x) => x.id));

  // Reset order whenever a new task arrives / items change
  useEffect(() => {
    setOrderIds(items.map((x) => x.id));
    if (onAnswerChange) onAnswerChange({ order: items.map((x) => x.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?._id, task?.id, items.length]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const pushDraft = (nextOrder) => {
    if (onAnswerChange) onAnswerChange({ order: nextOrder });
  };

  const move = (fromIdx, direction) => {
    if (disabled) return;
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= orderIds.length) return;

    const next = [...orderIds];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    setOrderIds(next);
    pushDraft(next);
  };

  const handleSubmit = () => {
    if (!onSubmit) return;
    onSubmit({ order: orderIds });
  };

  const promptText =
    (typeof task?.prompt === "string" && task.prompt.trim())
      ? task.prompt.trim()
      : "Put the items in the correct order.";

  const canSubmit = !disabled && Array.isArray(orderIds) && orderIds.length >= 2;

  return (
    <div className="p-4">
      <div className="mb-3">
        <div className="p-3 rounded-xl border bg-slate-50">
          <div className="font-bold mb-1">How to do this task</div>
          <div className="text-sm opacity-80">
            1) Read the items. 2) Use the arrows to move them up or down.
            3) When you are happy with the order, press <b>Submit</b>.
          </div>
        </div>
      </div>

      <h2 className="font-bold text-xl mb-3">{promptText}</h2>

      <div className="space-y-2 mb-4">
        {orderIds.map((id, idx) => {
          const it = byId.get(id);
          if (!it) return null;

          return (
            <div
              key={id}
              className="flex items-stretch justify-between border rounded px-3 py-2"
            >
              <div className="flex gap-3 min-w-0">
                {it.imageUrl ? (
                  <img
                    src={it.imageUrl}
                    alt=""
                    className="w-10 h-10 rounded object-cover border"
                  />
                ) : null}

                <div className="min-w-0">
                  <div className="font-semibold truncate">{it.primary}</div>

                  {it.secondary ? (
                    <div className="text-xs opacity-70 truncate">
                      {it.secondary}
                    </div>
                  ) : null}

                  {it.description ? (
                    <div className="text-xs opacity-80 line-clamp-2">
                      {it.description}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-1 pl-3">
                <button
                  className="border rounded px-2 text-xs"
                  onClick={() => move(idx, -1)}
                  disabled={disabled || idx === 0}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  className="border rounded px-2 text-xs"
                  onClick={() => move(idx, 1)}
                  disabled={disabled || idx === orderIds.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        className="w-full border rounded px-3 py-2 font-bold"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {canSubmit ? "Submit" : "Arrange at least 2 items"}
      </button>
    </div>
  );
}
