// student-app/src/components/tasks/types/VennSortTask.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * VennSort Task – Supports 2 or 3 overlapping circles
 * Items: 5–10 draggable words/numbers/concepts
 * Categories: 2–3 category names
 * Correct answer: { itemId: [category1, category2?] } map
 * Submission: { placements: { itemId: string[] } }
 * Objective scoring = true
 */

const pick = (obj, keys, fallback = null) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return fallback;
};

const makeStableId = (it, idx) => {
  const explicit = pick(it, ["id", "_id", "key"]);
  if (explicit) return explicit;

  const text = pick(it, ["text", "title", "label", "name", "value"]);
  return text ? `item-${idx}-${text.slice(0, 30)}` : `item-${idx}`;
};

export default function VennSortTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
}) {
  // Extract categories (2 or 3)
  const categories = useMemo(() => {
    const raw = task?.config?.categories || task?.categories || [];
    return Array.isArray(raw)
      ? raw.map(String).filter(Boolean).slice(0, 3)
      : [];
  }, [task]);

  const numCircles = categories.length;

  if (numCircles < 2 || numCircles > 3) {
    return (
      <div className="p-8 text-center text-red-600">
        Invalid VennSort: must have 2 or 3 categories.
      </div>
    );
  }

  // Extract items (5–10)
  const items = useMemo(() => {
    const raw =
      task?.config?.items ||
      task?.options ||
      task?.items ||
      [];

    return Array.isArray(raw)
      ? raw
          .filter(Boolean)
          .slice(0, 10)
          .map((it, idx) => {
            if (typeof it === "string") {
              return { id: makeStableId({ text: it }, idx), text: it };
            }
            const id = makeStableId(it, idx);
            const text = pick(it, ["text", "title", "label", "name", "value"], `Item ${idx + 1}`);
            const imageUrl = pick(it, ["imageUrl", "image", "img"]);
            return { id, text, imageUrl };
          })
      : [];
  }, [task]);

  // Current placements: { itemId: [cat1, cat2?] }
  const [placements, setPlacements] = useState(() => {
    const init = {};
    items.forEach((item) => (init[item.id] = []));
    return init;
  });

  // Reset on new task
  useEffect(() => {
    const init = {};
    items.forEach((item) => (init[item.id] = []));
    setPlacements(init);
    onAnswerChange?.({ placements: init });
  }, [task?._id, items.length, onAnswerChange]);

  // Drag handlers
  const handleDragStart = (e, itemId) => {
    e.dataTransfer.setData("itemId", itemId);
  };

  const handleDragOver = (e) => e.preventDefault();

  const handleDrop = (e, targetCategories) => {
    e.preventDefault();
    if (disabled) return;

    const itemId = e.dataTransfer.getData("itemId");
    if (!itemId) return;

    const sorted = [...targetCategories].sort(); // normalize order

    setPlacements((prev) => ({
      ...prev,
      [itemId]: sorted,
    }));

    onAnswerChange?.({
      placements: { ...placements, [itemId]: sorted },
    });
  };

  // Helper: get items in a specific zone (defined by exact sorted category list)
  const getItemsInZone = (zoneCats) => {
    const key = zoneCats.sort().join(",");
    return items.filter((item) => placements[item.id].sort().join(",") === key);
  };

  const handleSubmit = () => {
    onSubmit({ placements });
  };

  // Zone definitions for 3-circle Venn
  const zones = numCircles === 2
    ? [
        { cats: [categories[0]], label: categories[0], className: "left-only" },
        { cats: [categories[1]], label: categories[1], className: "right-only" },
        { cats: [categories[0], categories[1]], label: "Both", className: "overlap" },
      ]
    : [
        { cats: [categories[0]], label: categories[0], className: "a-only" },
        { cats: [categories[1]], label: categories[1], className: "b-only" },
        { cats: [categories[2]], label: categories[2], className: "c-only" },
        { cats: [categories[0], categories[1]], label: `${categories[0]} ∩ ${categories[1]}`, className: "ab" },
        { cats: [categories[0], categories[2]], label: `${categories[0]} ∩ ${categories[2]}`, className: "ac" },
        { cats: [categories[1], categories[2]], label: `${categories[1]} ∩ ${categories[2]}`, className: "bc" },
        { cats: [categories[0], categories[1], categories[2]], label: "All Three", className: "center" },
      ];

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h2 className="font-bold text-xl mb-6 text-center">{task?.prompt || "Sort the items into the Venn diagram"}</h2>

      <div className="relative w-full" style={{ aspectRatio: "1 / 1", maxHeight: "70vh" }}>
        {/* 3-Circle Venn Layout */}
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Circle A (Left) */}
          <div
            className="absolute w-64 h-64 rounded-full border-4 border-blue-500 bg-blue-200 bg-opacity-40 flex flex-col items-center justify-center text-blue-900 font-bold"
            style={{ left: "10%", top: "20%" }}
            onDrop={(e) => handleDrop(e, numCircles === 2 ? [categories[0]] : [categories[0]])}
            onDragOver={handleDragOver}
          >
            <div className="text-lg mb-2">{categories[0]}</div>
            <div className="flex flex-wrap gap-2 justify-center p-4">
              {getItemsInZone([categories[0]]).map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                  draggable={!disabled}
                  onDragStart={(e) => handleDragStart(e, item.id)}
                >
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          {/* Circle B (Right) */}
          <div
            className="absolute w-64 h-64 rounded-full border-4 border-amber-500 bg-amber-200 bg-opacity-40 flex flex-col items-center justify-center text-amber-900 font-bold"
            style={{ right: "10%", top: "20%" }}
            onDrop={(e) => handleDrop(e, numCircles === 2 ? [categories[1]] : [categories[1]])}
            onDragOver={handleDragOver}
          >
            <div className="text-lg mb-2">{categories[1]}</div>
            <div className="flex flex-wrap gap-2 justify-center p-4">
              {getItemsInZone([categories[1]]).map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                  draggable={!disabled}
                  onDragStart={(e) => handleDragStart(e, item.id)}
                >
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          {/* Circle C (Bottom) - only for 3 circles */}
          {numCircles === 3 && (
            <div
              className="absolute w-64 h-64 rounded-full border-4 border-red-500 bg-red-200 bg-opacity-40 flex flex-col items-center justify-center text-red-900 font-bold"
              style={{ left: "35%", bottom: "10%" }}
              onDrop={(e) => handleDrop(e, [categories[2]])}
              onDragOver={handleDragOver}
            >
              <div className="text-lg mb-2">{categories[2]}</div>
              <div className="flex flex-wrap gap-2 justify-center p-4">
                {getItemsInZone([categories[2]]).map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                    draggable={!disabled}
                    onDragStart={(e) => handleDragStart(e, item.id)}
                  >
                    {item.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overlap zones - transparent drop targets */}
          {numCircles === 3 && (
            <>
              {/* A ∩ B */}
              <div
                className="absolute w-40 h-48 bg-purple-300 bg-opacity-30 rounded-full flex items-center justify-center"
                style={{ left: "30%", top: "25%" }}
                onDrop={(e) => handleDrop(e, [categories[0], categories[1]])}
                onDragOver={handleDragOver}
              >
                <div className="flex flex-wrap gap-2 justify-center p-4">
                  {getItemsInZone([categories[0], categories[1]]).map((item) => (
                    <div
                      key={item.id}
                      className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                      draggable={!disabled}
                      onDragStart={(e) => handleDragStart(e, item.id)}
                    >
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* A ∩ C */}
              <div
                className="absolute w-40 h-40 bg-green-300 bg-opacity-30 rounded-full flex items-center justify-center"
                style={{ left: "25%", bottom: "20%" }}
                onDrop={(e) => handleDrop(e, [categories[0], categories[2]])}
                onDragOver={handleDragOver}
              >
                <div className="flex flex-wrap gap-2 justify-center p-4">
                  {getItemsInZone([categories[0], categories[2]]).map((item) => (
                    <div
                      key={item.id}
                      className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                      draggable={!disabled}
                      onDragStart={(e) => handleDragStart(e, item.id)}
                    >
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* B ∩ C */}
              <div
                className="absolute w-40 h-40 bg-orange-300 bg-opacity-30 rounded-full flex items-center justify-center"
                style={{ right: "25%", bottom: "20%" }}
                onDrop={(e) => handleDrop(e, [categories[1], categories[2]])}
                onDragOver={handleDragOver}
              >
                <div className="flex flex-wrap gap-2 justify-center p-4">
                  {getItemsInZone([categories[1], categories[2]]).map((item) => (
                    <div
                      key={item.id}
                      className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                      draggable={!disabled}
                      onDragStart={(e) => handleDragStart(e, item.id)}
                    >
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* A ∩ B ∩ C */}
              <div
                className="absolute w-32 h-32 bg-gray-400 bg-opacity-40 rounded-full flex items-center justify-center font-bold text-xs"
                style={{ left: "42%", top: "40%" }}
                onDrop={(e) => handleDrop(e, [categories[0], categories[1], categories[2]])}
                onDragOver={handleDragOver}
              >
                <div className="flex flex-wrap gap-2 justify-center p-4">
                  {getItemsInZone([categories[0], categories[1], categories[2]]).map((item) => (
                    <div
                      key={item.id}
                      className="px-3 py-1 bg-white rounded-full shadow cursor-grab text-xs"
                      draggable={!disabled}
                      onDragStart={(e) => handleDragStart(e, item.id)}
                    >
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 2-circle overlap (if only 2 circles) */}
          {numCircles === 2 && (
            <div
              className="absolute w-40 h-48 bg-purple-300 bg-opacity-40 rounded-full flex items-center justify-center font-bold"
              style={{ left: "35%", top: "25%" }}
              onDrop={(e) => handleDrop(e, [categories[0], categories[1]])}
              onDragOver={handleDragOver}
            >
              <div className="flex flex-wrap gap-2 justify-center p-4">
                {getItemsInZone([categories[0], categories[1]]).map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-2 bg-white rounded-full shadow cursor-grab text-sm"
                    draggable={!disabled}
                    onDragStart={(e) => handleDragStart(e, item.id)}
                  >
                    {item.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Unplaced items pool at bottom */}
        <div
          className="absolute bottom-4 left-4 right-4 bg-gray-100 rounded-lg p-4 border-2 border-dashed border-gray-400"
          onDrop={(e) => handleDrop(e, [])}
          onDragOver={handleDragOver}
        >
          <div className="text-center text-sm text-gray-600 mb-2">Drag items here if they belong nowhere</div>
          <div className="flex flex-wrap gap-3 justify-center">
            {getItemsInZone([]).map((item) => (
              <div
                key={item.id}
                className="px-5 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-full shadow-lg cursor-grab font-medium"
                draggable={!disabled}
                onDragStart={(e) => handleDragStart(e, item.id)}
              >
                {item.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        <button
          className="px-8 py-3 bg-green-600 text-white font-bold rounded-lg shadow hover:bg-green-700 disabled:opacity-50"
          onClick={handleSubmit}
          disabled={disabled}
        >
          Submit Answer
        </button>
      </div>
    </div>
  );
}