// student-app/src/components/tasks/types/MatchingTask.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

/**
 * MatchingTask
 * - Left column items match to right column items (one-to-one by left)
 * - Supports drag/drop AND tap-to-match (mobile-friendly)
 * - Draws SVG lines between matched items
 * - Undo stack (multi-step)
 *
 * Expected task shapes (any of these):
 * 1) task.pairs: [{ leftId,leftLabel,rightId,rightLabel }, ...]
 * 2) task.items: [{ left,leftLabel, right,rightLabel }, ...]
 * 3) task.leftItems + task.rightItems + task.correctMatches (optional)
 */
export default function MatchingTask({ task, onSubmit, disabled, onAnswerChange }) {
  // -----------------------------
  // Safe sound helper
  // -----------------------------
  const sounds = useMemo(
    () => ({
      match: "/sounds/match.mp3",
      undo: "/sounds/click.mp3",
      submit: "/sounds/victory.mp3",
    }),
    []
  );

  const playSound = useCallback((src) => {
    try {
      if (typeof Audio === "undefined") return;
      const a = new Audio(src);
      a.play().catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  // -----------------------------
  // Normalize data
  // -----------------------------
  const normalized = useMemo(() => {
    const fallbackPairs =
      (Array.isArray(task?.pairs) && task.pairs) ||
      (Array.isArray(task?.items) && task.items) ||
      [];

    // If teacher/AI supplied explicit columns, use them
    const explicitLeft = Array.isArray(task?.leftItems) ? task.leftItems : null;
    const explicitRight = Array.isArray(task?.rightItems) ? task.rightItems : null;

    // Common label/id pickers
    const pickId = (x, ...keys) => {
      for (const k of keys) {
        const v = x?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
      }
      return "";
    };
    const pickLabel = (x, ...keys) => {
      for (const k of keys) {
        const v = x?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
      }
      return "";
    };

    let leftItems = [];
    let rightItems = [];
    let correctMatches = {};

    if (explicitLeft && explicitRight) {
      leftItems = explicitLeft.map((x, idx) => ({
        id: pickId(x, "id", "leftId", "key") || `L${idx}`,
        label: pickLabel(x, "label", "text", "leftLabel", "left") || `Left ${idx + 1}`,
      }));

      rightItems = explicitRight.map((x, idx) => ({
        id: pickId(x, "id", "rightId", "key") || `R${idx}`,
        label: pickLabel(x, "label", "text", "rightLabel", "right") || `Right ${idx + 1}`,
      }));

      // Optional correctness map if provided
      if (task?.correctMatches && typeof task.correctMatches === "object") {
        correctMatches = Object.fromEntries(
          Object.entries(task.correctMatches).map(([k, v]) => [String(k), String(v)])
        );
      }
    } else {
      // Build from pairs/items
      leftItems = fallbackPairs.map((p, idx) => ({
        id: pickId(p, "leftId", "id", "leftKey", "left", "term") || `L${idx}`,
        label: pickLabel(p, "leftLabel", "leftText", "left", "term", "prompt") || `Left ${idx + 1}`,
      }));

      rightItems = fallbackPairs.map((p, idx) => ({
        id: pickId(p, "rightId", "matchId", "rightKey", "right", "definition") || `R${idx}`,
        label:
          pickLabel(p, "rightLabel", "rightText", "right", "definition", "answer") ||
          `Right ${idx + 1}`,
      }));

      correctMatches = Object.fromEntries(
        fallbackPairs.map((p, idx) => {
          const leftId = pickId(p, "leftId", "id", "leftKey", "left", "term") || `L${idx}`;
          const rightId =
            pickId(p, "rightId", "matchId", "rightKey", "right", "definition") || `R${idx}`;
          return [leftId, rightId];
        })
      );
    }

    // De-dup IDs defensively
    const uniq = (arr, prefix) => {
      const seen = new Set();
      return arr.map((x, idx) => {
        let id = String(x.id ?? "");
        if (!id) id = `${prefix}${idx}`;
        while (seen.has(id)) id = `${id}_${idx}`;
        seen.add(id);
        return { ...x, id };
      });
    };

    leftItems = uniq(leftItems, "L");
    rightItems = uniq(rightItems, "R");

    return { leftItems, rightItems, correctMatches };
  }, [task]);

  const { leftItems, rightItems, correctMatches } = normalized;

  // -----------------------------
  // State
  // -----------------------------
  const [matches, setMatches] = useState(() => ({})); // { [leftId]: rightId }
  const [history, setHistory] = useState([]); // array of snapshots of matches
  const [dragging, setDragging] = useState(null); // { fromId }
  const [tapSelectedLeft, setTapSelectedLeft] = useState(null); // leftId for tap-to-match
  const [lines, setLines] = useState([]); // { fromId, toId, x1,y1,x2,y2, correct? }

  // Refs for positioning
  const rootRef = useRef(null);
  const leftRefs = useRef(new Map()); // leftId -> element
  const rightRefs = useRef(new Map()); // rightId -> element

  // Reset when task changes meaningfully
  useEffect(() => {
    setMatches({});
    setHistory([]);
    setDragging(null);
    setTapSelectedLeft(null);
    setLines([]);
  }, [task?.id, task?.taskId, task?.prompt, leftItems.length, rightItems.length]);

  // -----------------------------
  // Helpers
  // -----------------------------
  const addMatch = useCallback(
    (fromId, toId) => {
      if (disabled) return;
      if (!fromId || !toId) return;
      // Do not allow overwriting an existing left match (simple rule)
      if (matches[fromId]) return;

      // Optional: prevent two lefts matching same right (one-to-one)
      const usedRight = new Set(Object.values(matches));
      if (usedRight.has(toId)) return;

      const next = { ...matches, [fromId]: toId };
      setHistory((prev) => [...prev, { ...matches }]); // snapshot
      setMatches(next);
      setTapSelectedLeft(null);
      playSound(sounds.match);
      onAnswerChange?.({ matches: next });
    },
    [disabled, matches, onAnswerChange, playSound, sounds.match]
  );

  const undoLastMatch = useCallback(() => {
    if (disabled) return;
    setHistory((prev) => {
      if (!prev.length) return prev;
      const previousMatches = prev[prev.length - 1];
      setMatches(previousMatches);
      onAnswerChange?.({ matches: previousMatches });
      playSound(sounds.undo);
      return prev.slice(0, -1);
    });
  }, [disabled, onAnswerChange, playSound, sounds.undo]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    onSubmit?.({ matches });
    playSound(sounds.submit);
  }, [disabled, matches, onSubmit, playSound, sounds.submit]);

  // -----------------------------
  // Line computation
  // -----------------------------
  const recomputeLines = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      setLines([]);
      return;
    }
    const rootRect = root.getBoundingClientRect();

    const nextLines = [];
    for (const [fromId, toId] of Object.entries(matches)) {
      const elL = leftRefs.current.get(fromId);
      const elR = rightRefs.current.get(toId);
      if (!elL || !elR) continue;

      const rL = elL.getBoundingClientRect();
      const rR = elR.getBoundingClientRect();

      // Points relative to root container
      const x1 = rL.right - rootRect.left;
      const y1 = rL.top + rL.height / 2 - rootRect.top;

      const x2 = rR.left - rootRect.left;
      const y2 = rR.top + rR.height / 2 - rootRect.top;

      const isCorrect = correctMatches?.[fromId] ? correctMatches[fromId] === toId : null;

      nextLines.push({ fromId, toId, x1, y1, x2, y2, correct: isCorrect });
    }
    setLines(nextLines);
  }, [matches, correctMatches]);

  useEffect(() => {
    recomputeLines();
  }, [recomputeLines]);

  useEffect(() => {
    const onResize = () => recomputeLines();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [recomputeLines]);

  // -----------------------------
  // Drag/drop handlers
  // -----------------------------
  const onDragStartLeft = (fromId) => {
    if (disabled) return;
    if (matches[fromId]) return;
    setDragging({ fromId });
  };

  const onDragEndLeft = () => {
    setDragging(null);
  };

  const onDropRight = (e, toId) => {
    e.preventDefault();
    if (disabled) return;
    if (!dragging?.fromId) return;
    addMatch(dragging.fromId, toId);
    setDragging(null);
  };

  const onDragOverRight = (e) => {
    // Required so drop works
    e.preventDefault();
  };

  // -----------------------------
  // Tap-to-match (mobile)
  // -----------------------------
  const onTapLeft = (fromId) => {
    if (disabled) return;
    if (matches[fromId]) return;
    setTapSelectedLeft((prev) => (prev === fromId ? null : fromId));
  };

  const onTapRight = (toId) => {
    if (disabled) return;
    if (!tapSelectedLeft) return;
    addMatch(tapSelectedLeft, toId);
  };

  // -----------------------------
  // Completion
  // -----------------------------
  const isComplete = leftItems.length > 0 && Object.keys(matches).length === leftItems.length;
  const canUndo = history.length > 0;

  if (!leftItems.length || !rightItems.length) {
    return (
      <div className="p-6">
        <div className="font-bold text-xl mb-2">Matching Task</div>
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          No matching items were provided for this task.
        </div>
        <pre className="mt-4 text-xs whitespace-pre-wrap opacity-70">
          {JSON.stringify(task, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto h-full flex flex-col">
      <h2 className="font-black text-2xl sm:text-3xl mb-3 text-center">
        {task?.prompt || "Draw lines to match concepts to words"}
      </h2>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
        <button
          type="button"
          onClick={undoLastMatch}
          disabled={!canUndo || disabled}
          className={`px-5 py-2.5 rounded-full font-extrabold shadow-lg transition-all ${
            canUndo && !disabled
              ? "bg-orange-500 hover:bg-orange-600 text-white"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
          title="Undo last match"
        >
          ↩ Undo
        </button>

        <div className="text-sm sm:text-base font-bold text-slate-700">
          {Object.keys(matches).length} / {leftItems.length} matched
          {tapSelectedLeft ? (
            <span className="ml-3 text-indigo-700">
              • Selected:{" "}
              <span className="underline">
                {leftItems.find((x) => x.id === tapSelectedLeft)?.label || tapSelectedLeft}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Play area */}
      <div
        ref={rootRef}
        className="relative flex-1 min-h-[420px] bg-gradient-to-r from-blue-50 to-indigo-100 rounded-3xl shadow-2xl overflow-hidden p-4 sm:p-6"
      >
        {/* SVG layer for lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {lines.map((ln) => {
            // Use stroke based on correctness if known
            const stroke =
              ln.correct === null ? "rgba(55,65,81,0.7)" : ln.correct ? "rgba(22,163,74,0.9)" : "rgba(220,38,38,0.9)";
            return (
              <line
                key={`${ln.fromId}=>${ln.toId}`}
                x1={ln.x1}
                y1={ln.y1}
                x2={ln.x2}
                y2={ln.y2}
                stroke={stroke}
                strokeWidth={6}
                strokeLinecap="round"
                opacity={0.9}
              />
            );
          })}
        </svg>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 h-full">
          {/* Left column */}
          <div className="flex flex-col gap-3">
            <div className="text-sm font-black text-slate-700 uppercase tracking-wide">
              Match these
            </div>

            {leftItems.map((item) => {
              const isMatched = !!matches[item.id];
              const isSelected = tapSelectedLeft === item.id;

              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) leftRefs.current.set(item.id, el);
                    else leftRefs.current.delete(item.id);
                  }}
                  draggable={!disabled && !isMatched}
                  onDragStart={() => onDragStartLeft(item.id)}
                  onDragEnd={onDragEndLeft}
                  onClick={() => onTapLeft(item.id)}
                  className={[
                    "select-none rounded-2xl border-2 shadow-md px-4 py-3 sm:px-5 sm:py-4",
                    "font-extrabold text-base sm:text-lg",
                    disabled ? "opacity-60" : "",
                    isMatched
                      ? "bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed"
                      : isSelected
                      ? "bg-indigo-600 border-indigo-700 text-white cursor-pointer"
                      : "bg-white border-slate-200 text-slate-800 cursor-grab active:cursor-grabbing",
                  ].join(" ")}
                  title={
                    isMatched
                      ? "Already matched"
                      : "Drag this to the right OR tap to select"
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="leading-snug">{item.label}</span>
                    <span className="text-xs font-black opacity-70">
                      {isMatched ? "✓" : "↔"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-3">
            <div className="text-sm font-black text-slate-700 uppercase tracking-wide">
              To these
            </div>

            {rightItems.map((item) => {
              // Right side can be used only once (one-to-one)
              const isUsed = Object.values(matches).includes(item.id);
              const canDrop = !disabled && !!dragging?.fromId && !isUsed;

              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) rightRefs.current.set(item.id, el);
                    else rightRefs.current.delete(item.id);
                  }}
                  onDragOver={canDrop ? onDragOverRight : undefined}
                  onDrop={canDrop ? (e) => onDropRight(e, item.id) : undefined}
                  onClick={() => onTapRight(item.id)}
                  className={[
                    "select-none rounded-2xl border-2 shadow-md px-4 py-3 sm:px-5 sm:py-4",
                    "font-extrabold text-base sm:text-lg",
                    disabled ? "opacity-60" : "",
                    isUsed
                      ? "bg-emerald-100 border-emerald-300 text-emerald-900 cursor-default"
                      : canDrop
                      ? "bg-yellow-100 border-yellow-400 text-slate-900 cursor-copy"
                      : "bg-white border-slate-200 text-slate-800 cursor-pointer",
                  ].join(" ")}
                  title={
                    isUsed
                      ? "Already used"
                      : dragging?.fromId
                      ? "Drop here"
                      : "Tap after selecting a left item"
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="leading-snug">{item.label}</span>
                    <span className="text-xs font-black opacity-70">
                      {isUsed ? "✓" : "⬇"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Drag hint */}
        {!disabled && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs sm:text-sm font-bold text-slate-700 opacity-70">
            Tip: Drag left → right, or tap a left item then tap a right item.
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isComplete || disabled}
          className={`px-8 py-3 rounded-2xl font-black text-lg shadow-xl transition-all ${
            isComplete && !disabled
              ? "bg-green-600 hover:bg-green-700 text-white"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
        >
          {isComplete ? "🎉 Submit Matches!" : `Complete ${leftItems.length - Object.keys(matches).length} more`}
        </button>

        {canUndo ? (
          <div className="text-sm font-bold text-orange-700">
            You can undo.
          </div>
        ) : (
          <div className="text-sm font-bold text-slate-500">
            No undo history yet.
          </div>
        )}
      </div>
    </div>
  );
}
