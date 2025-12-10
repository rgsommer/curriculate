// student-app/src/components/tasks/types/MindMapperTask.jsx
import React, { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ORGANIZERS = {
  "mind-map": { name: "Mind Map", center: true },
  hierarchy: { name: "Hierarchy Tree", levels: 3 },
  fishbone: { name: "Fishbone Diagram", causes: 4 },
  flowchart: { name: "Flow Chart", steps: true },
  venn: { name: "Venn Diagram", circles: 3 },
  web: { name: "Concept Web", connections: true },
};

function normalizeAndShuffleItems(task) {
  // Preferred: task.shuffledItems (already randomized from backend/editor)
  if (Array.isArray(task.shuffledItems) && task.shuffledItems.length > 0) {
    return task.shuffledItems.map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `item-${index}`,
          text: item,
          correctIndex: index,
        };
      }
      return {
        id: item.id ?? `item-${index}`,
        text:
          item.text ??
          item.label ??
          item.prompt ??
          item.name ??
          `Idea ${index + 1}`,
        correctIndex:
          typeof item.correctIndex === "number" ? item.correctIndex : index,
      };
    });
  }

  // Fallback: use task.items or task.options as the source
  const baseItems =
    (Array.isArray(task.items) && task.items.length > 0 && task.items) ||
    (Array.isArray(task.options) && task.options.length > 0 && task.options) ||
    [];

  const normalized = baseItems.map((item, index) => {
    if (typeof item === "string") {
      return { id: `item-${index}`, text: item, correctIndex: index };
    }
    return {
      id: item.id ?? `item-${index}`,
      text:
        item.text ??
        item.label ??
        item.prompt ??
        item.name ??
        `Idea ${index + 1}`,
      correctIndex:
        typeof item.correctIndex === "number" ? item.correctIndex : index,
    };
  });

  // Shuffle in-place (Fisher–Yates)
  for (let i = normalized.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [normalized[i], normalized[j]] = [normalized[j], normalized[i]];
  }
  return normalized;
}

function DraggableCard({ id, children, disabled }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "default" : "move",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!disabled ? { ...attributes, ...listeners } : {})}
      className="bg-white border-4 border-indigo-600 rounded-2xl p-6 text-3xl font-bold text-center shadow-xl hover:shadow-2xl"
    >
      {children}
    </div>
  );
}

export default function MindMapperTask({ task, onSubmit, disabled }) {
  const [items, setItems] = useState(() => normalizeAndShuffleItems(task));
  const organizer = ORGANIZERS[task.organizerType || "mind-map"];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    if (disabled) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prevItems) => {
      const oldIndex = prevItems.findIndex((i) => i.id === active.id);
      const newIndex = prevItems.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prevItems;

      const newItems = arrayMove(prevItems, oldIndex, newIndex);

      // Check win condition: each item's correctIndex matches its index
      const correct = newItems.every(
        (item, index) => item.correctIndex === index
      );
      if (correct) {
        try {
          // Non-blocking; ignore if audio can’t play
          new Audio("/sounds/victory.mp3").play();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Victory sound failed:", e);
        }
        if (onSubmit) {
          onSubmit({ completed: true });
        }
      }
      return newItems;
    });
  };

  const hasItems = Array.isArray(items) && items.length > 0;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-teal-500 to-blue-600">
      <h2 className="text-7xl font-bold text-white mb-8 drop-shadow-2xl text-center">
        MIND MAPPER: {organizer.name.toUpperCase()}
      </h2>

      {!hasItems ? (
        <p className="text-3xl text-white font-semibold">
          No concept cards are configured for this Mind Mapper task.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl">
              {items.map((item) => (
                <DraggableCard
                  key={item.id}
                  id={item.id}
                  disabled={disabled}
                >
                  {item.text}
                </DraggableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <p className="mt-12 text-5xl font-bold text-yellow-300 text-center">
        Drag the ideas into the correct structure!
      </p>
    </div>
  );
}
