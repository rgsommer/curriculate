// student-app/src/components/tasks/types/MatchingTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Matching / Connect (MATCHING)
 *
 * Supports task shapes:
 * - { leftItems:[{id,label|text}], rightItems:[{id,label|text}], correctMatches:{leftId:rightId} }
 * - { pairs:[{leftId,leftLabel,rightId,rightLabel}] } (will be normalized)
 * - { items:[{left, right}] } (fallback)
 *
 * Play UI:
 * - Two columns. Students connect pairs by tapping (left then right) to draw a line.
 * - Undo button for last connection + Clear.
 *
 * Review UI:
 * - Draw the CORRECT lines for every left item.
 * - Color the correct line GREEN if the student got it right,
 *   and RED if the student originally matched it incorrectly.
 *
 * Submission payload:
 *   { matches: { [leftId]: rightId } }
 */
export default function MatchingTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  mode = "play",
  review,
  readOnly,
}) {
  const norm = (x) => String(x ?? "").trim();
  const getLabel = (it) => norm(it?.label ?? it?.text ?? it?.term ?? it?.value ?? it?.name);

  const normalized = useMemo(() => {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};

    const leftRaw =
      (Array.isArray(task?.leftItems) && task.leftItems) ||
      (Array.isArray(cfg?.leftItems) && cfg.leftItems) ||
      null;

    const rightRaw =
      (Array.isArray(task?.rightItems) && task.rightItems) ||
      (Array.isArray(cfg?.rightItems) && cfg.rightItems) ||
      null;

    const pairsRaw =
      (Array.isArray(task?.pairs) && task.pairs) ||
      (Array.isArray(task?.items) && task.items) ||
      (Array.isArray(cfg?.pairs) && cfg.pairs) ||
      (Array.isArray(cfg?.items) && cfg.items) ||
      [];

    let leftItems = [];
    let rightItems = [];
    let correctMatches = {};

    if (leftRaw && rightRaw) {
      leftItems = leftRaw.map((x, idx) => ({
        id: norm(x?.id ?? x?._id ?? `L${idx + 1}`) || `L${idx + 1}`,
        label: getLabel(x) || `Left ${idx + 1}`,
      }));
      rightItems = rightRaw.map((x, idx) => ({
        id: norm(x?.id ?? x?._id ?? `R${idx + 1}`) || `R${idx + 1}`,
        label: getLabel(x) || `Right ${idx + 1}`,
      }));

      const cm =
        (task?.correctMatches && typeof task.correctMatches === "object" && task.correctMatches) ||
        (task?.correctAnswer && typeof task.correctAnswer === "object" && task.correctAnswer) ||
        (cfg?.correctMatches && typeof cfg.correctMatches === "object" && cfg.correctMatches) ||
        (cfg?.correctAnswer && typeof cfg.correctAnswer === "object" && cfg.correctAnswer) ||
        {};

      correctMatches = Object.fromEntries(Object.entries(cm).map(([k, v]) => [norm(k), norm(v)]));
    } else {
      // Build from pairs
      leftItems = pairsRaw.map((p, idx) => ({
        id: norm(p?.leftId ?? p?.id ?? `L${idx + 1}`) || `L${idx + 1}`,
        label: norm(p?.leftLabel ?? p?.leftText ?? p?.left ?? p?.term ?? `Left ${idx + 1}`),
      }));
      rightItems = pairsRaw.map((p, idx) => ({
        id: norm(p?.rightId ?? p?.matchId ?? `R${idx + 1}`) || `R${idx + 1}`,
        label: norm(p?.rightLabel ?? p?.rightText ?? p?.right ?? p?.definition ?? `Right ${idx + 1}`),
      }));

      correctMatches = Object.fromEntries(
        pairsRaw.map((p, idx) => [
          norm(p?.leftId ?? p?.id ?? `L${idx + 1}`) || `L${idx + 1}`,
          norm(p?.rightId ?? p?.matchId ?? `R${idx + 1}`) || `R${idx + 1}`,
        ])
      );
    }

    // Guard: ensure unique IDs
    const uniq = (arr, prefix) => {
      const seen = new Set();
      return arr.map((it, idx) => {
        let id = norm(it.id) || `${prefix}${idx + 1}`;
        while (seen.has(id)) id = `${id}-${idx + 1}`;
        seen.add(id);
        return { ...it, id };
      });
    };

    return {
      leftItems: uniq(leftItems, "L"),
      rightItems: uniq(rightItems, "R"),
      correctMatches,
    };
  }, [task]);

  const leftItems = normalized.leftItems;
  const rightItems = normalized.rightItems;
  const correctMatches = normalized.correctMatches;

  const isReview = mode === "review" || !!review || !!readOnly;
  const isDisabled = !!disabled || !!readOnly || isReview;

  // Try to read student matches from the review payload (supports a couple common shapes)
  const reviewMatches =
    (review && typeof review === "object" && (review.matches || review.answer?.matches || review.studentAnswer?.matches)) ||
    null;

  const [matches, setMatches] = useState({}); // { [leftId]: rightId }
  const [activeLeft, setActiveLeft] = useState(null); // click-to-match support
  const [activeRight, setActiveRight] = useState(null);
  const [dragLeft, setDragLeft] = useState(null);
  const svgRef = useRef(null);

  // Reset when task changes
  useEffect(() => {
    setMatches({});
    setActiveLeft(null);
    setActiveRight(null);
    setDragLeft(null);
  }, [task?.taskType, task?.title, task?.prompt]);

  // In review mode, show the student's selections (for state), but lines will render from correctMatches
  useEffect(() => {
    if (!isReview) return;
    if (!reviewMatches || typeof reviewMatches !== "object") return;
    setMatches(Object.fromEntries(Object.entries(reviewMatches).map(([k, v]) => [norm(k), norm(v)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReview]);

  // Notify parent
  useEffect(() => {
    if (isReview) return;
    onAnswerChange?.({ matches });
  }, [matches, onAnswerChange, isReview]);

  const isComplete = leftItems.length > 0 && Object.keys(matches).length === leftItems.length;

  const getLeftForRight = (rightId) => {
    const entry = Object.entries(matches).find(([, r]) => r === rightId);
    return entry ? entry[0] : null;
  };

  const canMatch = (leftId, rightId) => {
    if (!leftId || !rightId) return false;
    if (isDisabled) return false;
    if (matches[leftId]) return false; // left already used
    if (Object.values(matches).includes(rightId)) return false; // right already used
    return true;
  };

  const doMatch = (leftId, rightId) => {
    if (!canMatch(leftId, rightId)) return;
    setMatches((prev) => ({ ...prev, [leftId]: rightId }));
    setActiveLeft(null);
    setActiveRight(null);
    setDragLeft(null);
  };

  const undoLast = () => {
    if (isDisabled) return;
    const keys = Object.keys(matches);
    if (!keys.length) return;
    const lastKey = keys[keys.length - 1];
    setMatches((prev) => {
      const next = { ...prev };
      delete next[lastKey];
      return next;
    });
  };

  const clearAll = () => {
    if (isDisabled) return;
    setMatches({});
    setActiveLeft(null);
    setActiveRight(null);
    setDragLeft(null);
  };

  const handleSubmit = () => {
    if (!isComplete || isDisabled) return;
    onSubmit?.({ matches });
  };

  // Lines:
  // - PLAY: draw lines for current `matches`. Color: neutral blue while playing.
  // - REVIEW: draw lines for the CORRECT mapping, but color GREEN if student's answer for that left was correct, else RED.
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const compute = () => {
      const svg = svgRef.current;
      if (!svg) return;

      const container = svg.parentElement;
      if (!container) return;

      const crect = container.getBoundingClientRect();

      const next = [];

      if (isReview) {
        // Draw correct lines, colored by student correctness
        for (const left of leftItems) {
          const leftId = left.id;
          const correctRightId = correctMatches?.[leftId];
          if (!correctRightId) continue;

          const le = document.getElementById(`match-left-${leftId}`);
          const re = document.getElementById(`match-right-${correctRightId}`);
          if (!le || !re) continue;

          const lrect = le.getBoundingClientRect();
          const rrect = re.getBoundingClientRect();

          const x1 = lrect.right - crect.left;
          const y1 = lrect.top + lrect.height / 2 - crect.top;
          const x2 = rrect.left - crect.left;
          const y2 = rrect.top + rrect.height / 2 - crect.top;

          const studentPicked = matches?.[leftId];
          const ok = studentPicked === correctRightId;

          next.push({ x1, y1, x2, y2, ok, review: true });
        }
      } else {
        for (const [leftId, rightId] of Object.entries(matches)) {
          const le = document.getElementById(`match-left-${leftId}`);
          const re = document.getElementById(`match-right-${rightId}`);
          if (!le || !re) continue;

          const lrect = le.getBoundingClientRect();
          const rrect = re.getBoundingClientRect();

          const x1 = lrect.right - crect.left;
          const y1 = lrect.top + lrect.height / 2 - crect.top;
          const x2 = rrect.left - crect.left;
          const y2 = rrect.top + rrect.height / 2 - crect.top;

          next.push({ x1, y1, x2, y2, ok: null, review: false });
        }
      }

      setLines(next);
    };

    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [matches, correctMatches, isReview, leftItems]);

  if (!leftItems.length || !rightItems.length) {
    return (
      <div className="p-6">
        <div className="text-xl font-bold mb-2">Matching Task</div>
        <div className="text-red-600 font-semibold">No matching items were provided for this task.</div>
        <pre className="mt-4 text-xs bg-slate-100 p-3 rounded overflow-auto">
          {JSON.stringify(task, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-4 rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 shadow-lg p-4 md:p-5">
        <div className="text-base md:text-lg font-extrabold text-slate-900">
          {isReview ? "Review" : "How to match"}
        </div>
        <div className="mt-1 text-sm md:text-base text-slate-700">
          {isReview ? (
            <>
              Lines show the <span className="font-extrabold">correct</span> matches. Green means your match was right; red means you matched it incorrectly.
            </>
          ) : (
            <>
              Tap a word on the <span className="font-extrabold">left</span>, then tap its match on the <span className="font-extrabold">right</span> to draw a line. Use <span className="font-extrabold">Undo</span> if you make a mistake.
            </>
          )}
        </div>
      </div>

      <div className="text-center mb-4">
        <div className="text-2xl font-extrabold">{task?.title || "Matching / Connect"}</div>
        <div className="opacity-80 mt-1">{task?.prompt || "Match each item on the left to the correct item on the right."}</div>
      </div>

      <div className="relative rounded-3xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        {/* Lines */}
        <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none">
          {lines.map((ln, idx) => {
            const stroke = ln.review
              ? ln.ok
                ? "rgba(34,197,94,0.88)" // green
                : "rgba(239,68,68,0.88)" // red
              : "rgba(59,130,246,0.75)"; // blue during play

            return (
              <line
                key={idx}
                x1={ln.x1}
                y1={ln.y1}
                x2={ln.x2}
                y2={ln.y2}
                strokeWidth="4"
                strokeLinecap="round"
                stroke={stroke}
              />
            );
          })}
        </svg>

        <div className="grid grid-cols-2 gap-3 md:gap-6 p-4 md:p-8">
          {/* Left */}
          <div className="space-y-3">
            {leftItems.map((it) => {
              const chosen = !!matches[it.id];
              const active = activeLeft === it.id;
              return (
                <button
                  key={it.id}
                  id={`match-left-${it.id}`}
                  type="button"
                  draggable={!isDisabled && !chosen}
                  onDragStart={() => setDragLeft({ leftId: it.id })}
                  onDragEnd={() => setDragLeft(null)}
                  onClick={() => {
                    if (isDisabled) return;
                    if (chosen) return;
                    setActiveLeft((prev) => (prev === it.id ? null : it.id));
                    if (activeRight && canMatch(it.id, activeRight)) doMatch(it.id, activeRight);
                  }}
                  className={[
                    "w-full text-left px-4 py-3 rounded-2xl border font-bold transition",
                    chosen ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100",
                    active ? "ring-4 ring-blue-200 border-blue-300" : "",
                    isDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  {it.label}
                  {chosen && <span className="ml-2 text-xs font-extrabold text-slate-400">✓</span>}
                </button>
              );
            })}
          </div>

          {/* Right */}
          <div className="space-y-3">
            {rightItems.map((it) => {
              const usedBy = getLeftForRight(it.id);
              const chosen = !!usedBy;
              const active = activeRight === it.id;

              return (
                <button
                  key={it.id}
                  id={`match-right-${it.id}`}
                  type="button"
                  onDragOver={(e) => {
                    if (!dragLeft || isDisabled) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!dragLeft) return;
                    doMatch(dragLeft.leftId, it.id);
                  }}
                  onClick={() => {
                    if (isDisabled) return;
                    if (chosen) return;
                    setActiveRight((prev) => (prev === it.id ? null : it.id));
                    if (activeLeft && canMatch(activeLeft, it.id)) doMatch(activeLeft, it.id);
                  }}
                  className={[
                    "w-full text-left px-4 py-3 rounded-2xl border font-bold transition",
                    chosen ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-white border-slate-200 hover:bg-slate-50",
                    active ? "ring-4 ring-blue-200 border-blue-300" : "",
                    isDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  {it.label}
                  {chosen && <span className="ml-2 text-xs font-extrabold text-slate-400">used</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!isReview && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={undoLast}
            disabled={isDisabled || Object.keys(matches).length === 0}
            className={[
              "px-4 py-2 rounded-full font-extrabold border",
              isDisabled || Object.keys(matches).length === 0
                ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                : "bg-orange-600 text-white border-orange-700 hover:bg-orange-700",
            ].join(" ")}
          >
            Undo
          </button>

          <button
            type="button"
            onClick={clearAll}
            disabled={isDisabled || Object.keys(matches).length === 0}
            className={[
              "px-4 py-2 rounded-full font-extrabold border",
              isDisabled || Object.keys(matches).length === 0
                ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                : "bg-slate-800 text-white border-slate-900 hover:bg-black",
            ].join(" ")}
          >
            Clear
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isComplete || isDisabled}
            className={[
              "px-6 py-2 rounded-full font-extrabold border transition",
              isComplete && !isDisabled
                ? "bg-green-600 text-white border-green-700 hover:bg-green-700"
                : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed",
            ].join(" ")}
          >
            {isComplete ? "Submit" : `Match ${leftItems.length - Object.keys(matches).length} more`}
          </button>
        </div>
      )}
    </div>
  );
}
