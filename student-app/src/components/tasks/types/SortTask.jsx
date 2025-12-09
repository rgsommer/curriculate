import React, { useState, useEffect } from "react";

import {
  DndContext,
  closestCenter,
  PointerSensor,
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
    background: visual.background || "rgba(255,255,255,0.95)",
    border: `2px solid ${
      visual.borderColor || "rgba(203,213,225,0.4)"
    }`,
    borderRadius: 12,
    padding: "12px 16px",
    margin: "6px 8px",
    boxShadow: isDragging
      ? "0 12px 30px rgba(0,0,0,0.18)"
      : "0 3px 10px rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    cursor: disabled ? "not-allowed" : "grab",
    userSelect: "none",
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

  const rawBuckets = Array.isArray(config.buckets)
    ? config.buckets
    : Array.isArray(task?.buckets)
    ? task.buckets
    : [];

  const buckets = rawBuckets.map((b, i) => ({
    id: `bucket-${i}`,
    title:
      typeof b === "string"
        ? b
        : b.label || b.name || `Bucket ${i + 1}`,
  }));

  const rawItems = Array.isArray(config.items)
    ? config.items
    : Array.isArray(task?.items)
    ? task.items
    : [];

  // Support both manual tasks (correctBucket) and AI tasks (bucketIndex)
  const items = rawItems.map((it, idx) => {
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
    buckets.forEach((b) => {
      empty[b.id] = [];
    });
    return empty;
  };

  const [assignments, setAssignments] = useState(initialAssignments);

  // -------------------------------
  // Partial Credit Scoring
  // -------------------------------
  const scoring = items.reduce(
    (acc, item) => {
      const placedIn = Object.entries(assignments).find(
        ([, ids]) => ids.includes(item.id),
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

  const finalScore = Math.round(
    (scoring.points / scoring.total) * 100,
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
      itemsInBucket.filter((i) => i.correctBucket === null)
        .length * 0.5;
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
  // Drag & Drop setup
  // -------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

      if (overId === "pool") {
        // Dropped back into the "Items to sort" pool → unassign item
        targetBucketId = null;
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
          // Fallback: treat as unassigned
          targetBucketId = null;
        }
      }

      // 3) Build new assignments: remove from old bucket
      const newAssignments = {};
      for (const [bId, ids] of Object.entries(assignments)) {
        newAssignments[bId] = ids.filter((id) => id !== itemId);
      }

      // 4) Add to new bucket (if not pool/unassigned)
      if (targetBucketId) {
        newAssignments[targetBucketId] = [
          ...newAssignments[targetBucketId],
          itemId,
        ];
      }

      setAssignments(newAssignments);
    };

  const allItemsPlaced =
    Object.values(assignments).flat().length === items.length;

  const unassignedItems = items.filter(
    (i) =>
      !Object.values(assignments)
        .flat()
        .includes(i.id),
  );


  // -------------------------------
  // Render
  // -------------------------------
  return (
    <div style={{ marginTop: 16 }}>
          <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {unassignedItems.length > 0 && (
        <DroppableBucket
          id="pool"
          title="Items to sort"
          scoreInfo={null}
        >
          <SortableContext
            items={unassignedItems.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            {unassignedItems.map((item) => (
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
      )}

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
              .map((id) =>
                items.find((i) => i.id === id),
              )
              .filter(Boolean)
              .map((item) => {
                const placedIn = Object.entries(
                  assignments,
                ).find(([, ids]) =>
                  ids.includes(item.id),
                )?.[0];
                const score =
                  placedIn === item.correctBucket
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
          Final Score: {finalScore}% (
          {scoring.points.toFixed(1)} / {scoring.total} points)
        </div>
      )}

      <button
        onClick={() =>
          onSubmit({
            assignments,
            score: finalScore,
          })
        }
        disabled={disabled || !allItemsPlaced}
        style={{
          marginTop: 24,
          width: "100%",
          padding: "16px",
          borderRadius: 999,
          border: "none",
          background:
            disabled || !allItemsPlaced
              ? "#94a3b8"
              : "#22c55e",
          color: "white",
          fontWeight: 700,
          fontSize: "1.1rem",
          cursor:
            disabled || !allItemsPlaced
              ? "not-allowed"
              : "pointer",
        }}
      >
        {disabled
          ? "Submitted"
          : allItemsPlaced
          ? "Submit Sorting"
          : "Place all items first"}
      </button>
    </div>
  );
}
