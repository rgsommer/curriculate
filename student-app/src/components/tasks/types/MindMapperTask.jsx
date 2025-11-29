//student-app/src/components/tasks/types/MindMapperTask.jsx
import React, { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ORGANIZERS = {
  "mind-map": { name: "Mind Map", center: true },
  "hierarchy": { name: "Hierarchy Tree", levels: 3 },
  "fishbone": { name: "Fishbone Diagram", causes: 4 },
  "flowchart": { name: "Flow Chart", steps: true },
  "venn": { name: "Venn Diagram", circles: 3 },
  "web": { name: "Concept Web", connections: true },
};

function DraggableCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="bg-white border-4 border-indigo-600 rounded-2xl p-6 text-3xl font-bold text-center cursor-move shadow-xl hover:shadow-2xl">
      {children}
    </div>
  );
}

export default function MindMapperTask({ task, onSubmit, disabled }) {
  const [items, setItems] = useState(task.shuffledItems || []);
  const organizer = ORGANIZERS[task.organizerType || "mind-map"];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        // Check win condition
        const correct = newItems.every((item, i) => item.correctIndex === i);
        if (correct) {
          new Audio("/sounds/victory.mp3").play();
          onSubmit({ completed: true });
        }
        return newItems;
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-teal-500 to-blue-600">
      <h2 className="text-7xl font-bold text-white mb-8 drop-shadow-2xl">
        MIND MAPPER: {organizer.name.toUpperCase()}
      </h2>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-3 gap-8 max-w-6xl">
            {items.map((item) => (
              <DraggableCard key={item.id} id={item.id}>
                {item.text}
              </DraggableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <p className="mt-12 text-5xl font-bold text-yellow-300">
        Drag into correct order!
      </p>
    </div>
  );
}