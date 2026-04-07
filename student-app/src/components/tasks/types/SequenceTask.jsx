// student-app/src/components/tasks/types/SequenceTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useThemeMode } from "../../../utils/ThemeModeContext.js";

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
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const items = useMemo(() => {
    const raw =
      (Array.isArray(task?.config?.items) && task.config.items.length > 0 && task.config.items) ||
      (Array.isArray(task?.items) && task.items.length > 0 && task.items) ||
      (Array.isArray(task?.options) && task.options.length > 0 && task.options) ||
      (Array.isArray(task?.steps) && task.steps.length > 0 && task.steps) ||
      (Array.isArray(task?.sequence) && task.sequence.length > 0 && task.sequence) ||
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

  const cardBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(248,250,252,1)";
  const borderColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(15,23,42,0.12)";
  const textColor = isDark ? "#fff" : "#0f172a";
  const subtextColor = isDark ? "rgba(226,232,240,0.8)" : "rgba(15,23,42,0.72)";
  const btnBg = isDark ? "rgba(255,255,255,0.10)" : "#fff";

  return (
    <div className="p-4" style={{ color: textColor }}>
      <div className="mb-3">
        <div className="p-3 rounded-xl" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
          <div className="font-bold mb-1">How to do this task</div>
          <div className="text-sm" style={{ color: subtextColor }}>
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
              className="flex items-stretch justify-between rounded px-3 py-2"
              style={{ border: `1px solid ${borderColor}`, background: cardBg }}
            >
              <div className="flex gap-3 min-w-0">
                {it.imageUrl ? (
                  <img
                    src={it.imageUrl}
                    alt=""
                    className="w-10 h-10 rounded object-cover"
                    style={{ border: `1px solid ${borderColor}` }}
                  />
                ) : null}

                <div className="min-w-0">
                  <div className="font-semibold truncate">{it.primary}</div>

                  {it.secondary ? (
                    <div className="text-xs truncate" style={{ color: subtextColor }}>
                      {it.secondary}
                    </div>
                  ) : null}

                  {it.description ? (
                    <div className="text-xs line-clamp-2" style={{ color: subtextColor }}>
                      {it.description}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-1 pl-3">
                {idx > 0 ? (
                  <button
                    className="rounded px-2 text-xs"
                    style={{ border: `1px solid ${borderColor}`, background: btnBg, color: textColor }}
                    onClick={() => move(idx, -1)}
                    disabled={disabled}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                ) : (
                  <div className="px-2 text-xs invisible">↑</div>
                )}
                {idx < orderIds.length - 1 ? (
                  <button
                    className="rounded px-2 text-xs"
                    style={{ border: `1px solid ${borderColor}`, background: btnBg, color: textColor }}
                    onClick={() => move(idx, 1)}
                    disabled={disabled}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                ) : (
                  <div className="px-2 text-xs invisible">↓</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        className="w-full rounded px-3 py-2 font-bold"
        style={{ border: `1px solid ${borderColor}`, background: isDark ? "rgba(99,102,241,0.3)" : "#fff", color: textColor }}
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {canSubmit ? "Submit" : "Arrange at least 2 items"}
      </button>
    </div>
  );
}
