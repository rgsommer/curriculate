// student-app/src/components/tasks/types/SequenceTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useThemeMode } from "../../../utils/ThemeModeContext.js";
import { isDarkTheme } from "../../../utils/themeHelpers.js";

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
  const isDark = isDarkTheme(themeMode);
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

  // Shuffle items so they don't appear in the correct (answer) order
  const shuffleIds = (ids) => {
    const arr = [...ids];
    // Fisher-Yates with a simple seed from task id for consistency
    const seed = String(task?._id || task?.id || "seq");
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
    const rand = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // If shuffle produced the original order, swap first two
    if (arr.length >= 2 && arr.every((id, idx) => id === ids[idx])) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  };

  const [orderIds, setOrderIds] = useState(() => shuffleIds(items.map((x) => x.id)));

  // Reset order whenever a new task arrives / items change
  useEffect(() => {
    const shuffled = shuffleIds(items.map((x) => x.id));
    setOrderIds(shuffled);
    if (onAnswerChange) onAnswerChange({ order: shuffled });
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

  // Tester: 'no layover for answer' — the user wants a brief reveal
  // showing which positions were right vs. wrong before advancing.
  // Compute the canonical order (by original input position) and
  // hold the answer-reveal state for ~3.5s before submitting.
  const correctOrderIds = useMemo(() => items.map((x) => x.id), [items]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState(null); // { correctSlots: number, total: number }
  const reviewTimerRef = useRef(null);

  const handleSubmit = () => {
    if (!onSubmit) return;
    const correctSlots = orderIds.reduce(
      (n, id, idx) => n + (id === correctOrderIds[idx] ? 1 : 0),
      0
    );
    setReviewResult({ correctSlots, total: orderIds.length });
    setReviewing(true);
    // Auto-submit after a short hold so the player gets to see what
    // they got right and where they slipped.
    if (reviewTimerRef.current) clearTimeout(reviewTimerRef.current);
    reviewTimerRef.current = setTimeout(() => {
      onSubmit({
        order: orderIds,
        correctOrder: correctOrderIds,
        correctSlots,
        total: orderIds.length,
      });
    }, 3500);
  };

  // Cleanup any pending submission timer if the task unmounts early.
  useEffect(() => () => {
    if (reviewTimerRef.current) clearTimeout(reviewTimerRef.current);
  }, []);

  const promptText =
    (typeof task?.prompt === "string" && task.prompt.trim())
      ? task.prompt.trim()
      : "Put the items in the correct order.";

  const canSubmit = !disabled && !reviewing && Array.isArray(orderIds) && orderIds.length >= 2;

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

      {/* Review banner — appears for ~3.5s after Submit so the
          tester sees what they got right before advancing. */}
      {reviewing && reviewResult && (
        <div
          className="mb-3 px-4 py-3 rounded-xl"
          style={{
            background: reviewResult.correctSlots === reviewResult.total
              ? "rgba(34,197,94,0.18)"
              : "rgba(245,158,11,0.18)",
            border: `2px solid ${reviewResult.correctSlots === reviewResult.total ? "#22c55e" : "#f59e0b"}`,
            color: textColor,
            fontWeight: 800,
            textAlign: "center",
          }}
        >
          {reviewResult.correctSlots === reviewResult.total
            ? "🎉 Perfect order! "
            : `${reviewResult.correctSlots}/${reviewResult.total} in the right spot. `}
          <span style={{ fontWeight: 600 }}>
            Green = correct slot · Red = wrong slot. Advancing in a moment…
          </span>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {orderIds.map((id, idx) => {
          const it = byId.get(id);
          if (!it) return null;
          const isCorrectSlot = reviewing && correctOrderIds[idx] === id;
          const slotBorder = reviewing
            ? (isCorrectSlot ? "#22c55e" : "#ef4444")
            : borderColor;
          const slotBg = reviewing
            ? (isCorrectSlot ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)")
            : cardBg;

          return (
            <div
              key={id}
              className="flex items-stretch justify-between rounded px-3 py-2"
              style={{ border: `2px solid ${slotBorder}`, background: slotBg, transition: "all 0.2s" }}
            >
              <div className="flex gap-3 min-w-0">
                {reviewing && (
                  <div
                    style={{
                      fontSize: 20,
                      width: 28,
                      textAlign: "center",
                      alignSelf: "center",
                      color: isCorrectSlot ? "#22c55e" : "#ef4444",
                      fontWeight: 900,
                    }}
                  >
                    {isCorrectSlot ? "✓" : "✗"}
                  </div>
                )}
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
                    disabled={disabled || reviewing}
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
                    disabled={disabled || reviewing}
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
