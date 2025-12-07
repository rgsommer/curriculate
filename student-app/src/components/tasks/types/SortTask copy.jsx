// student-app/src/components/tasks/types/SortTask.jsx
import React, { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, CheckCircle2, XCircle, MinusCircle } from "lucide-react";

function SortableItem({ id, children, disabled, score }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        background: disabled
          ? score === 1
            ? "rgba(34,197,94,0.12)"
            : score === 0
            ? "rgba(239,68,68,0.12)"
            : "rgba(251,191,36,0.12)"
          : "rgba(255,255,255,0.95)",
        border: `2px solid ${
          disabled
            ? score === 1
              ? "#22c55e"
              : score === 0
              ? "#ef4444"
              : "#f59e0b"
            : "rgba(203,213,225,0.4)"
        }`,
        borderRadius: 12,
        padding: "12px 16px",
        margin: "6px 8px",
        boxShadow: isDragging ? "0 12px 30px rgba(0,0,0,0.18)" : "0 3px 10px rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: disabled ? "not-allowed" : "grab",
      }}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="w-5 h-5 text-gray-500" />
      <span style={{ fontSize: "1rem", fontWeight: 500, flex: 1 }}>{children}</span>
      {disabled && score === 1 && <CheckCircle2 className="w-5 h-5 text-green-600" />}
      {disabled && score === 0 && <XCircle className="w-5 h-5 text-red-600" />}
      {disabled && score > 0 && score < 1 && <MinusCircle className="w-5 h-5 text-amber-600" />}
    </div>
  );
}

export default function SortTask({ task, onSubmit, disabled, onAnswerChange, answerDraft }: any) {
  // ... keep all your existing normalization, scoring, etc. exactly as before ...

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setOrder((items) => {
      const oldIndex = items.indexOf(active.id);
      const newIndex = items.indexOf(over.id);
      const newOrder = arrayMove(items, oldIndex, newIndex);
      onAnswerChange({ order: newOrder });
      return newOrder;
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        {order.map((id) => {
          const item = items.find((i) => i.id === id);
          const score = /* your existing scoring logic */;
          return (
            <SortableItem key={id} id={id} disabled={disabled} score={disabled ? score : null}>
              {item.text}
            </SortableItem>
          );
        })}
      </SortableContext>
    </DndContext>
    // ... rest of your UI (score display, submit button) ...
  );
}