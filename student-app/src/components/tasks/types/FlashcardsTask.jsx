// student-app/src/components/tasks/types/FlashcardsTask.jsx
import React, { useMemo, useState } from "react";

export default function FlashcardsTask({ task, onSubmit, disabled }) {
  const cards = useMemo(() => {
    const fromCards = Array.isArray(task?.cards) ? task.cards : null;
    if (fromCards?.length) {
      return fromCards
        .map((c) => ({
          question: c?.question ?? c?.front ?? c?.q ?? "",
          answer: c?.answer ?? c?.back ?? c?.a ?? "",
        }))
        .filter(
          (c) =>
            String(c.question || "").trim() && String(c.answer || "").trim()
        );
    }

    const fromItems = Array.isArray(task?.config?.items) ? task.config.items : null;
    if (fromItems?.length) {
      return fromItems
        .map((it) => ({
          question: it?.question ?? it?.front ?? it?.q ?? "",
          answer: it?.answer ?? it?.back ?? it?.a ?? "",
        }))
        .filter(
          (c) =>
            String(c.question || "").trim() && String(c.answer || "").trim()
        );
    }

    return [];
  }, [task]);

  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  if (!cards.length) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white/80 shadow-xl p-6 text-center">
          <div className="text-xl font-semibold text-slate-900">
            No flashcards available.
          </div>
          <div className="mt-2 text-slate-600">
            This task expects <code>task.cards</code> or <code>task.config.items</code> with
            <code>question</code>/<code>answer</code>.
          </div>
        </div>
      </div>
    );
  }

  const current = cards[index];

  const goPrev = () => {
    if (index > 0) {
      setShowAnswer(false);
      setIndex((v) => v - 1);
    }
  };

  const goNext = () => {
    if (index < cards.length - 1) {
      setShowAnswer(false);
      setIndex((v) => v + 1);
    }
  };

  const handleDone = () => {
    // Mastery/low-stress by default; still allows tracking if you want.
    onSubmit && onSubmit({ viewedCards: index + 1, totalCards: cards.length });
  };

  return (
    <div className="h-full w-full flex flex-col">
      {/* Top banner (kept light so it fits any parent "task card" container) */}
      <div className="px-4 pt-4">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-900 via-purple-900 to-fuchsia-900 text-white shadow-xl border border-white/10 overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/80">
                FLASHCARDS
              </div>
              <div className="text-base md:text-lg font-bold truncate">
                {task?.title || "Flashcards"}
              </div>
              {task?.prompt ? (
                <div className="mt-1 text-sm md:text-base text-white/80 line-clamp-2">
                  {task.prompt}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs text-white/70">Card</div>
              <div className="text-lg md:text-2xl font-black">
                {index + 1} <span className="text-white/60">/</span> {cards.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main card area */}
      <div className="flex-1 px-4 py-4">
        <div className="h-full rounded-3xl bg-slate-950/90 border border-white/10 shadow-2xl overflow-hidden relative">
          {/* subtle glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-fuchsia-500/10 pointer-events-none" />

          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowAnswer((v) => !v)}
            className={`relative z-10 w-full h-full p-6 md:p-10 flex items-center justify-center text-center
              focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400/50
              ${disabled ? "cursor-not-allowed opacity-90" : "cursor-pointer"}`}
            aria-label={showAnswer ? "Hide answer (show question)" : "Reveal answer"}
          >
            <div className="max-w-5xl w-full">
              <div className="text-white/70 text-sm md:text-base font-semibold tracking-wide">
                {showAnswer ? "ANSWER" : "QUESTION"}
              </div>

              <div
                className={`mt-4 font-black leading-tight ${
                  showAnswer ? "text-4xl md:text-6xl" : "text-4xl md:text-6xl"
                } text-white`}
                style={{
                  // big, readable, but prevents insane overflow
                  wordBreak: "break-word",
                }}
              >
                {showAnswer ? current.answer : current.question}
              </div>

              <div className="mt-6 text-white/70 text-base md:text-lg">
                {disabled ? (
                  <span>Locked…</span>
                ) : (
                  <span>
                    Tap to {showAnswer ? "flip back" : "reveal"}.
                  </span>
                )}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 pb-4">
        <div className="rounded-3xl bg-white/90 border border-slate-200 shadow-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={disabled || index === 0}
              className={`px-4 py-2 rounded-full font-bold transition
                ${
                  disabled || index === 0
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
            >
              ◀ Prev
            </button>

            <button
              type="button"
              onClick={goNext}
              disabled={disabled || index >= cards.length - 1}
              className={`px-4 py-2 rounded-full font-bold transition
                ${
                  disabled || index >= cards.length - 1
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
            >
              Next ▶
            </button>

            <button
              type="button"
              onClick={() => setShowAnswer((v) => !v)}
              disabled={disabled}
              className={`px-4 py-2 rounded-full font-bold transition
                ${
                  disabled
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
            >
              {showAnswer ? "Show Q" : "Show A"}
            </button>
          </div>

          <button
            type="button"
            onClick={handleDone}
            disabled={disabled}
            className={`px-5 py-2 rounded-full font-black transition
              ${
                disabled
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
