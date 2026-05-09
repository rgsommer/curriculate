import React, { useState, useEffect } from "react";
import clsx from "clsx";

import {
  DndContext,
  // closestCenter requires the *dragged item's* bounding-box centre to be
  // inside the droppable, which on a small phone screen makes the drop zone
  // feel like only the middle third of the bucket actually accepts a drop.
  // pointerWithin tracks the pointer/finger itself — much more forgiving and
  // matches the user's mental model.  We compose with rectIntersection as a
  // fallback so flick-style drops (where the pointer leaves the drop zone
  // before the drop fires) still snap to the closest bucket.
  pointerWithin,
  rectIntersection,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";

import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import {
  GripVertical,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";

function SortableItem({ id, children, disabled, score }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const getStyle = () => {
    if (!disabled) return {};
    if (score === 1)
      return {
        borderColor: "#22c55e",
        background: "rgba(34,197,94,0.12)",
      };
    if (score === 0)
      return {
        borderColor: "#ef4444",
        background: "rgba(239,68,68,0.12)",
      };
    return {
      borderColor: "#f59e0b",
      background: "rgba(251,191,36,0.12)",
    }; // partial
  };

  const visual = getStyle();

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.8 : 1,
    background: visual.background || "#ffffff",
    border: `2px solid ${
      visual.borderColor || "#cbd5e1"
    }`,
    borderRadius: 12,
    padding: "12px 16px",
    margin: "6px 8px",
    color: "#1e293b",
    boxShadow: isDragging
      ? "0 12px 30px rgba(0,0,0,0.18)"
      : "0 3px 10px rgba(0,0,0,0.10)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    cursor: disabled ? "not-allowed" : "grab",
    userSelect: "none",
    touchAction: "none", // 💡 important for touch dragging on Android/iOS
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <GripVertical className="w-5 h-5 text-gray-500 flex-shrink-0" />
      <span
        style={{
          fontSize: "1rem",
          fontWeight: 500,
          flex: 1,
        }}
      >
        {children}
      </span>
      {disabled && score === 1 && (
        <CheckCircle2 className="w-5 h-5 text-green-600" />
      )}
      {disabled && score === 0 && (
        <XCircle className="w-5 h-5 text-red-600" />
      )}
      {disabled && score > 0 && score < 1 && (
        <MinusCircle className="w-5 h-5 text-amber-600" />
      )}
    </div>
  );
}

function DroppableBucket({ id, title, children, scoreInfo }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 140,
        padding: 16,
        marginBottom: 20,
        background: isOver
          ? "rgba(34,197,94,0.15)"
          : "rgba(243,244,246,0.8)",
        border: `2px dashed ${isOver ? "#22c55e" : "#94a3b8"}`,
        borderRadius: 16,
        transition: "all 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "1.2rem",
            fontWeight: 700,
            color: "#1e293b",
          }}
        >
          {title}
        </h3>
        {scoreInfo && (
          <span
            style={{
              fontSize: "0.95rem",
              fontWeight: 700,
              color: scoreInfo.perfect
                ? "#22c55e"
                : scoreInfo.partial
                ? "#f59e0b"
                : "#ef4444",
            }}
          >
            {scoreInfo.points.toFixed(1)} / {scoreInfo.max}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          minHeight: 60,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function SortTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  // -------------------------------
  // Normalise config
  // -------------------------------
  const config = task?.config || {};

  // A special pool for items not yet placed
  const UNSORTED_BUCKET_ID = "unsorted";

  const rawBuckets =
    Array.isArray(config.buckets) && config.buckets.length > 0
      ? config.buckets
      : Array.isArray(config.categories) && config.categories.length > 0
      ? config.categories
      : Array.isArray(config.groups) && config.groups.length > 0
      ? config.groups
      : Array.isArray(task?.buckets) && task.buckets.length > 0
      ? task.buckets
      : Array.isArray(task?.categories) && task.categories.length > 0
      ? task.categories
      : Array.isArray(task?.groups) && task.groups.length > 0
      ? task.groups
      : [];

  const safeRawBuckets =
    rawBuckets.length > 0 ? rawBuckets : ["Group A", "Group B"];

  const buckets = safeRawBuckets.map((b, i) => ({
    id: `bucket-${i}`,
    title:
      typeof b === "string"
        ? b
        : b.label ||
          b.name ||
          b.title ||
          b.category ||
          `Bucket ${i + 1}`,
  }));

  // Try several possible locations for the items, depending on how the task was saved
  const rawItems =
    (Array.isArray(config.items) && config.items.length > 0
      ? config.items
      : Array.isArray(config.sortItems) && config.sortItems.length > 0
      ? config.sortItems
      : Array.isArray(config.events) && config.events.length > 0
      ? config.events
      : Array.isArray(task?.items) && task.items.length > 0
      ? task.items
      : []);

  // Defensive fallback: if AI forgot the items, provide a tiny practice set.
  const safeRawItems = rawItems.length > 0 ? rawItems : [
    { text: "Example item 1", bucketIndex: 0 },
    { text: "Example item 2", bucketIndex: 1 },
    { text: "Example item 3", bucketIndex: 0 },
  ];

  if (rawItems.length === 0) {
    console.log("[SortTask] No items found for sort task", {
      task,
      config,
      configKeys: Object.keys(config || {}),
    });
  }

  // Support both manual tasks (correctBucket) and AI tasks (bucketIndex)
  const items = safeRawItems.map((it, idx) => {
    const text =
      typeof it === "string"
        ? it
        : it.text ??
          it.label ??
          it.name ??
          it.prompt ??
          `Item ${idx + 1}`;

    let correctIndex = null;
    if (it && typeof it === "object") {
      if (typeof it.correctBucket === "number") {
        correctIndex = it.correctBucket;
      } else if (typeof it.bucketIndex === "number") {
        correctIndex = it.bucketIndex; // AI TaskGen shape
      } else if (typeof it.bucket === "number") {
        correctIndex = it.bucket;
      }
    }

    return {
      id: `item-${idx}`,
      text,
      correctBucket:
        correctIndex !== null && correctIndex !== undefined
          ? `bucket-${correctIndex}`
          : null,
    };
  });

  // -------------------------------
  // State: bucket assignments
  // -------------------------------
  const initialAssignments = () => {
    if (
      answerDraft?.assignments &&
      typeof answerDraft.assignments === "object"
    ) {
      return { ...answerDraft.assignments };
    }

    const empty = {};

    // Start with everything in the unsorted pool
    empty[UNSORTED_BUCKET_ID] = items.map((it) => it.id);

    // Real buckets start empty
    buckets.forEach((b) => {
      empty[b.id] = [];
    });

    return empty;
  };

  const [assignments, setAssignments] = useState(initialAssignments);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const getBucketIndexForItem = (itemId) => {
    // Find the bucket (except UNSORTED) that contains this item id
    const bucketId = Object.entries(assignments).find(
      ([bId, ids]) =>
        bId !== UNSORTED_BUCKET_ID && ids.includes(itemId),
    )?.[0];

    if (!bucketId) return null;

    const idx = buckets.findIndex((b) => b.id === bucketId);
    return idx >= 0 ? idx : null;
  };

  useEffect(() => {
    setHasSubmitted(false);
  }, [task?._id, task?.id]);

  // -------------------------------
  // Partial Credit Scoring
  // -------------------------------
  const scoring = items.reduce(
    (acc, item) => {
      const placedIn = Object.entries(assignments).find(
        ([bucketId, ids]) =>
          bucketId !== UNSORTED_BUCKET_ID && ids.includes(item.id),
      )?.[0];

      const isCorrect = placedIn === item.correctBucket;

      const score =
        isCorrect
          ? 1
          : item.correctBucket !== null
          ? 0
          : 0.5; // 0.5 for items without a defined correct bucket

      acc.total += 1;
      acc.points += score;
      return acc;
    },
    { points: 0, total: items.length || 1 },
  );

  const bucketScores = buckets.map((bucket) => {
    const itemsInBucket = (assignments[bucket.id] || [])
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean);

    const correct = itemsInBucket.filter(
      (i) => i.correctBucket === bucket.id,
    ).length;

    const total = itemsInBucket.length;

    const maxPossible = items.filter(
      (i) => i.correctBucket === bucket.id,
    ).length;

    const partial =
      itemsInBucket.filter((i) => i.correctBucket === null).length * 0.5;

    const points = correct + partial;

    return {
      correct,
      total,
      max: maxPossible || Math.max(total, 1),
      points,
      perfect:
        maxPossible > 0 &&
        points === maxPossible &&
        total >= maxPossible,
      partial: partial > 0,
    };
  });

  const rubricTotal = bucketScores.reduce(
    (sum, b) => sum + (Number(b.max) || 0),
    0
  );

  const denom = rubricTotal || scoring.total || 1;
  const finalScore = Math.round((scoring.points / denom) * 100);

  // Push live draft up to parent (for autosave / resume)
  useEffect(() => {
    if (typeof onAnswerChange === "function") {
      onAnswerChange({
        assignments,
        score: finalScore,
      });
    }
  }, [assignments, finalScore, onAnswerChange]);

  // -------------------------------
  // Drag & Drop setup (with touch support)
  // -------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Soft "tick" sound on every successful drop — testers asked for audible
  // feedback so they know the bucket actually accepted the item. Lazy
  // WebAudio oscillator: zero asset weight, no autoplay-policy issues
  // because user just interacted (drag = gesture).
  const playDropTick = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playDropTick._ctx || (playDropTick._ctx = new Ctx());
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(620, t0);
      osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.08);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    } catch {}
  };

  const handleDragEnd = (event) => {
    if (disabled) return;

    const { active, over } = event;
    if (!over) return;

    const itemId = active.id;
    const overId = over.id;

    // 1) Find where the item came from
    let fromBucket = null;
    for (const [bId, ids] of Object.entries(assignments)) {
      if (ids.includes(itemId)) {
        fromBucket = bId;
        break;
      }
    }

    // 2) Work out which container we actually dropped into
    let targetBucketId = null;

    if (overId === UNSORTED_BUCKET_ID) {
      // Dropped into the unsorted pool
      targetBucketId = UNSORTED_BUCKET_ID;
    } else if (buckets.some((b) => b.id === overId)) {
      // Dropped on a bucket itself (empty area)
      targetBucketId = overId;
    } else {
      // Likely dropped on TOP OF another item → find that item's bucket
      const found = Object.entries(assignments).find(([, ids]) =>
        ids.includes(overId),
      );
      if (found) {
        targetBucketId = found[0];
      } else {
        // Fallback: put it back into unsorted
        targetBucketId = UNSORTED_BUCKET_ID;
      }
    }

    // 3) Build new assignments: remove from all buckets
    const newAssignments = {};
    for (const [bId, ids] of Object.entries(assignments)) {
      newAssignments[bId] = ids.filter((id) => id !== itemId);
    }

    // 4) Add to new bucket
    if (!newAssignments[targetBucketId]) {
      newAssignments[targetBucketId] = [];
    }
    newAssignments[targetBucketId].push(itemId);

    setAssignments(newAssignments);
    // Only chirp when the drop actually moved the item somewhere new.
    if (fromBucket !== targetBucketId) playDropTick();
  };

  const allItemsPlaced =
    assignments &&
    Array.isArray(assignments[UNSORTED_BUCKET_ID]) &&
    assignments[UNSORTED_BUCKET_ID].length === 0 &&
    items.length > 0;

  const unassignedItems =
    assignments[UNSORTED_BUCKET_ID] || [];

  // -------------------------------
  // Render
  // -------------------------------
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            padding: 12,
            background: "#fef9c3",
            border: "2px solid #f59e0b",
            borderRadius: 16,
            color: "#78350f",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>How to do this task</div>
          <div style={{ fontSize: "0.95rem", lineHeight: 1.35 }}>
            1) Drag each item into the correct bucket. 2) When the <b>Unsorted items</b> area is empty,
            press <b>Submit answer</b>.
          </div>
        </div>
        {task?.prompt ? (
          <div style={{ marginTop: 10, fontWeight: 800, fontSize: "1.1rem", color: "#0f172a" }}>
            {String(task.prompt)}
          </div>
        ) : null}
      </div>
      <DndContext
        sensors={sensors}
        // Pointer-following collision detection: forgiving on touch.
        // Fall back to rectIntersection (broad rectangle overlap) so users
        // who release just outside a bucket still get the expected snap.
        collisionDetection={(args) => {
          const pw = pointerWithin(args);
          if (pw && pw.length > 0) return pw;
          return rectIntersection(args);
        }}
        onDragEnd={handleDragEnd}
      >
        {/* Unsorted pool at the top */}
        <DroppableBucket
          id={UNSORTED_BUCKET_ID}
          title="Unsorted items"
          scoreInfo={null}
        >
          <SortableContext
            items={assignments[UNSORTED_BUCKET_ID] || []}
            strategy={rectSortingStrategy}
          >
            {(assignments[UNSORTED_BUCKET_ID] || [])
              .map((id) => items.find((i) => i.id === id))
              .filter(Boolean)
              .map((item) => (
                <SortableItem
                  key={item.id}
                  id={item.id}
                  disabled={disabled}
                  score={null}
                >
                  {item.text}
                </SortableItem>
              ))}
          </SortableContext>
        </DroppableBucket>

        {/* Actual target buckets */}
        {buckets.map((bucket, idx) => (
          <DroppableBucket
            key={bucket.id}
            id={bucket.id}
            title={bucket.title}
            scoreInfo={disabled ? bucketScores[idx] : null}
          >
            <SortableContext
              items={assignments[bucket.id] || []}
              strategy={rectSortingStrategy}
            >
              {(assignments[bucket.id] || [])
                .map((id) => items.find((i) => i.id === id))
                .filter(Boolean)
                .map((item) => {
                  // Where is this item placed?
                  const placedIn = Object.entries(assignments).find(
                    ([bucketId, ids]) =>
                      bucketId !== UNSORTED_BUCKET_ID &&
                      ids.includes(item.id),
                  )?.[0];

                  const isCorrect = placedIn === item.correctBucket;
                  const score =
                    isCorrect
                      ? 1
                      : item.correctBucket !== null
                      ? 0
                      : 0.5;

                  return (
                    <SortableItem
                      key={item.id}
                      id={item.id}
                      disabled={disabled}
                      score={disabled ? score : null}
                    >
                      {item.text}
                    </SortableItem>
                  );
                })}
            </SortableContext>
          </DroppableBucket>
        ))}

        {unassignedItems.length > 0 && (
          <div
            style={{
              padding: 20,
              background: "rgba(254,242,242,0.6)",
              border: "2px dashed #ef4444",
              borderRadius: 16,
              textAlign: "center",
              fontWeight: 600,
              color: "#991b1b",
            }}
          >
            Drag items into buckets
          </div>
        )}
      </DndContext>

      {disabled && (
        <div
          style={{
            marginTop: 24,
            padding: 20,
            background:
              finalScore >= 80
                ? "rgba(34,197,94,0.15)"
                : finalScore >= 50
                ? "rgba(251,191,36,0.15)"
                : "rgba(239,68,68,0.15)",
            borderRadius: 16,
            textAlign: "center",
            fontSize: "2rem",
            fontWeight: 800,
            color:
              finalScore >= 80
                ? "#22c55e"
                : finalScore >= 50
                ? "#f59e0b"
                : "#ef4444",
          }}
        >
          Final Score: {Math.round(
            (scoring.points / (rubricTotal || scoring.total)) * 100
          )}% (
          {scoring.points.toFixed(1)} / {rubricTotal || scoring.total} points)
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          const payloadItems = items.map((item) => ({
            text: item.text,
            bucketIndex: getBucketIndexForItem(item.id),
          }));

          const payload = {
            buckets: buckets.map((b) => b.title),
            items: payloadItems,
          };

          onSubmit(payload);
          setHasSubmitted(true);
        }}
        disabled={disabled || hasSubmitted || !allItemsPlaced}
        className={clsx(
          "w-full px-4 py-2 rounded-lg text-sm font-semibold border transition",
          disabled || hasSubmitted || !allItemsPlaced
            ? "bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed"
            : "bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
        )}
      >
        {disabled || hasSubmitted ? "Submitted" : "Submit answer"}
      </button>
    </div>
  );
}
