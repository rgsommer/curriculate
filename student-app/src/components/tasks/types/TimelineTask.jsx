// student-app/src/components/tasks/types/TimelineTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * TimelineTask (solo)
 * - Drag-to-order timeline events (4–8 items).
 * - Objective-scored via submitted ordered ids: { type: "timeline", order: [...] }
 *
 * Expected task shapes (generator-friendly):
 * - task.items OR task.events OR task.config.items: [{ id, text, year? }]
 * - task.correctOrder: [id1, id2, ...]
 * - task.shuffledItems (optional): initial order of item objects
 */
export default function TimelineTask({ task, onSubmit, disabled }) {
  const t = task || {};
  const taskKey = String(t._id || t.id || t.taskId || "timeline");

  // Grade 7-friendly, explicit directions.
  const instructions =
    "How to play: Drag the cards into the correct time order (earliest → latest). " +
    "If dragging feels tricky on your device, use the ← and → buttons on each card. " +
    "When you are happy with the order, press Submit.";

  const normalizeItems = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .map((it, idx) => {
        if (it == null) return null;
        if (typeof it === "string") {
          return { id: `${idx}`, text: it, year: null };
        }
        const id = String(it.id ?? it._id ?? idx);
        const text = String(it.text ?? it.label ?? it.event ?? it.title ?? it.name ?? "").trim();
        const year = it.year ?? it.date ?? it.when ?? null;
        return { id, text: text || `Event ${idx + 1}`, year };
      })
      .filter(Boolean);
  };

  // Robust item extraction — check all possible locations with explicit length checks
  // (mirrors SequenceTask's extraction pattern for consistency)
  const sourceItems =
    (Array.isArray(t.shuffledItems) && t.shuffledItems.length > 0 && t.shuffledItems) ||
    (Array.isArray(t.items) && t.items.length > 0 && t.items) ||
    (Array.isArray(t.events) && t.events.length > 0 && t.events) ||
    (Array.isArray(t.config?.items) && t.config.items.length > 0 && t.config.items) ||
    (Array.isArray(t.config?.events) && t.config.events.length > 0 && t.config.events) ||
    (Array.isArray(t.config?.sequence) && t.config.sequence.length > 0 && t.config.sequence) ||
    (Array.isArray(t.sequence) && t.sequence.length > 0 && t.sequence) ||
    (Array.isArray(t.steps) && t.steps.length > 0 && t.steps) ||
    (Array.isArray(t.options) && t.options.length > 0 && t.options) ||
    [];

  const baseItems = useMemo(() => {
    const result = normalizeItems(sourceItems);
    if (result.length < 2) {
      console.warn("[TimelineTask] No usable items found. Task keys:", Object.keys(t),
        "| items:", t.items, "| config.items:", t.config?.items,
        "| config.sequence:", t.config?.sequence);
    }
    return result;
  }, [taskKey]);

  // Never show a dead-end screen if the generator forgets items.
  // Make a simple playable placeholder using whatever context we have.
  const fallbackItems = useMemo(() => {
    if (baseItems.length >= 2) return baseItems;

    const seedText = String(t?.prompt || t?.title || t?.topic || "").trim();
    const safe = seedText ? seedText.replace(/\s+/g, " ").slice(0, 64) : "your topic";

    // These are intentionally generic, but they keep the task usable.
    const ph = [
      { id: "ph-1", text: `Start of ${safe}`, year: null },
      { id: "ph-2", text: `Early event about ${safe}`, year: null },
      { id: "ph-3", text: `Later event about ${safe}`, year: null },
      { id: "ph-4", text: `End of ${safe}`, year: null },
    ];
    return ph;
  }, [baseItems, t?.prompt, t?.title, t?.topic]);

  // If generator did not provide shuffledItems, do a stable shuffle for initial display
  const seededShuffle = (array, seedStr) => {
    const copy = [...array];
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) {
      seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    }
    const rand = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed >>>= 0;
      seed ^= seed << 5;
      seed >>>= 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const initialOrder = useMemo(() => {
    if (Array.isArray(t.shuffledItems) && t.shuffledItems.length) return baseItems;
    return seededShuffle(fallbackItems, `timeline:${taskKey}`);
  }, [baseItems, fallbackItems, taskKey]);

  const [order, setOrder] = useState(() => initialOrder);

  useEffect(() => {
    setOrder(initialOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey]);

  const correctOrder = Array.isArray(t.correctOrder) ? t.correctOrder.map(String) : null;

  const canSubmit = order.length >= 2 && !disabled;

  const submitClassName = canSubmit
    ? "px-4 py-2 rounded font-semibold bg-blue-600 text-white hover:bg-blue-700"
    : "px-4 py-2 rounded font-semibold bg-gray-200 text-gray-500";

  // Drag-and-drop
  const dragIdRef = useRef(null);

  const onDragStart = (id) => {
    dragIdRef.current = id;
  };

  const onDropOn = (targetId) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    if (!fromId || fromId === targetId) return;

    setOrder((prev) => {
      const fromIdx = prev.findIndex((x) => x.id === fromId);
      const toIdx = prev.findIndex((x) => x.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;

      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const move = (id, dir) => {
    setOrder((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[idx];
      next[idx] = next[nextIdx];
      next[nextIdx] = tmp;
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const orderedIds = order.map((x) => x.id);

    onSubmit?.({
      type: "timeline",
      order: orderedIds,
      // Helpful for debugging/transcript; backend can ignore safely.
      correctOrder: correctOrder || undefined,
    });
  };

  // UI styling (kept inline for predictable builds)
  const shell = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(255,255,255,0.86)",
    padding: 12,
    overflow: "hidden",
  };

  const railWrap = {
    position: "relative",
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(255,255,255,1) 100%)",
    padding: 12,
    overflow: "auto",
    flex: 1,
    minHeight: 0,
  };

  const rail = {
    position: "absolute",
    left: 12,
    right: 12,
    top: 34,
    height: 6,
    borderRadius: 999,
    background: "rgba(14,165,233,0.25)",
  };

  const row = {
    position: "relative",
    display: "flex",
    gap: 10,
    alignItems: "stretch",
    paddingTop: 16,
    paddingBottom: 8,
    minWidth: 560, // encourages horizontal feel; still scrollable on small screens
  };

  const card = {
    width: 220,
    flex: "0 0 auto",
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#ffffff",
    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
    padding: 12,
    cursor: disabled ? "not-allowed" : "grab",
    userSelect: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  const dot = {
    width: 14,
    height: 14,
    borderRadius: 999,
    background: "rgba(14,165,233,1)",
    boxShadow: "0 0 0 6px rgba(14,165,233,0.18)",
  };

  // Year chip intentionally removed — showing the year on each card made
  // the chronology task trivial (students could just read the dates and
  // sort numerically). The card now shows only the event text; the
  // underlying `it.year` is preserved on the task object for grading.

  // Shared style for the ← → reorder buttons. Earlier rendering used a
  // near-invisible 14%-opacity border on a white background, which had
  // very low contrast against the white card. Bump to a dark outline +
  // tinted fill so the buttons read clearly.
  const arrowBtn = {
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.45)",
    background: "#eef2ff",
    color: "#0f172a",
    padding: "4px 10px",
    fontWeight: 900,
    fontSize: "1rem",
    lineHeight: 1,
  };

  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0f172a" }}>
          🗓️ Timeline – Drag to Order
        </div>
        <button type="button" className={submitClassName} onClick={handleSubmit} disabled={!canSubmit}>
          Submit
        </button>
      </div>

      {t.prompt && (
        <div style={{ marginTop: 8, fontSize: "0.98rem", color: "#334155", fontWeight: 600 }}>
          {t.prompt}
        </div>
      )}

      <div style={{ marginTop: 10, marginBottom: 10, color: "#475569", fontSize: "0.92rem" }}>
        <div style={{ fontWeight: 900, marginBottom: 4 }}>Instructions</div>
        <div>{instructions}</div>
        {baseItems.length < 2 && (
          <div style={{ marginTop: 8, color: "#b45309", fontWeight: 800 }}>
            Note: This timeline was missing events, so we loaded a simple practice set.
          </div>
        )}
      </div>

      <div style={railWrap}>
        <div style={rail} aria-hidden="true" />
        <div style={row}>
          {order.map((it, idx) => (
            <div
              key={it.id}
              style={card}
              draggable={!disabled}
              onDragStart={() => onDragStart(it.id)}
              onDragOver={(e) => {
                if (disabled) return;
                e.preventDefault();
              }}
              onDrop={() => onDropOn(it.id)}
              title="Drag to reorder"
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={dot} aria-hidden="true" />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => move(it.id, -1)}
                    disabled={disabled}
                    style={{ ...arrowBtn, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}
                    aria-label="Move left"
                    title="Move earlier"
                  >
                    ←
                  </button>
                  )}
                  {idx < order.length - 1 && (
                  <button
                    type="button"
                    onClick={() => move(it.id, +1)}
                    disabled={disabled}
                    style={{ ...arrowBtn, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}
                    aria-label="Move right"
                    title="Move later"
                  >
                    →
                  </button>
                  )}
                </div>
              </div>

              {/* Year deliberately hidden from students — was making the task trivial */}

              <div style={{ fontWeight: 800, fontSize: "0.98rem", color: "#0f172a", lineHeight: 1.25 }}>
                {it.text}
              </div>

              <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.8rem" }}>
                <span>Drop here</span>
                <span style={{ fontWeight: 900 }}>#{order.findIndex((x) => x.id === it.id) + 1}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* correctOrder hint removed — was leaking developer info to students */}
    </div>
  );
}
