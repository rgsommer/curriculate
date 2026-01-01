// student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useEffect, useMemo } from "react";

export default function BrainSparkNotesTask({ task, onSubmit, disabled }) {
  const bullets = Array.isArray(task?.bullets) ? task.bullets : [];
  const title = String(task?.title || "Brain Spark Notes");
  const subtitle = String(task?.subtitle || "Understanding Key Concepts");
  const pointsText = String(task?.pointsText || "+10 points for everyone!");

  const date = useMemo(() => {
    try {
      return new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    if (task?.completed) {
      try {
        new Audio("/sounds/victory.mp3").play();
      } catch {
        // ignore
      }
    }
  }, [task?.completed]);

  const stickerRow = (task?.config?.stickers && Array.isArray(task.config.stickers))
    ? task.config.stickers
    : ["✨", "🧠", "📒", "⭐", "✅"];

  const writingFont =
    task?.gradeLevel && parseInt(task.gradeLevel) <= 4
      ? "font-printing"
      : "font-handwriting";

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50">
      <style>{`
        @keyframes bs-float {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes bs-pop {
          0% { transform: scale(0.98); opacity: 0.9; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div className="relative w-full max-w-5xl">
        {/* Soft “desk” glow */}
        <div className="absolute -inset-4 rounded-[2.25rem] bg-gradient-to-r from-amber-200/40 via-yellow-200/40 to-orange-200/40 blur-2xl" />

        {/* Notebook */}
        <div className="relative rounded-[2.25rem] border bg-white shadow-2xl overflow-hidden" style={{ animation: "bs-pop 250ms ease-out" }}>
          {/* Spiral binding */}
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-b from-gray-100 to-gray-50 border-r" />
          <div className="absolute left-6 top-8 bottom-8 w-4 flex flex-col justify-between">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="h-5 w-5 rounded-full border bg-white shadow-sm" />
            ))}
          </div>

          {/* Paper lines */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-28 top-0 bottom-0 w-[3px] bg-red-500/70" />
            <div className="absolute inset-0 pl-28 pr-6 pt-6 pb-6">
              <div className="h-full w-full rounded-3xl bg-gradient-to-b from-amber-50 to-white" />
            </div>
            <div className="absolute inset-0 pl-28 pr-6 pt-20 pb-24 opacity-60">
              <div className="h-full flex flex-col justify-between">
                {Array.from({ length: 18 }, (_, i) => (
                  <div key={i} className="border-t border-blue-200" />
                ))}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="relative z-10 pl-28 pr-6 pt-7 pb-28">
            {/* Top badges */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="px-4 py-2 rounded-full border bg-white shadow-sm font-black text-sm tracking-widest">
                  🧠 BRAIN SPARK NOTES
                </div>
                <div className="px-3 py-2 rounded-full border bg-yellow-50 text-sm font-bold text-gray-700">
                  {subtitle}
                </div>
              </div>

              <div className="px-3 py-2 rounded-full border bg-white text-sm font-bold text-gray-600">
                {date}
              </div>
            </div>

            {/* Stickers */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {stickerRow.map((s, i) => (
                <div
                  key={i}
                  className="px-3 py-2 rounded-2xl border bg-white shadow-sm text-xl"
                  style={{ animation: "bs-float 1.6s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
                  aria-hidden="true"
                >
                  {s}
                </div>
              ))}
            </div>

            {/* Title (smaller to avoid double-title vibes) */}
            <div className="mt-6">
              <div className="text-3xl md:text-4xl font-extrabold text-indigo-800 leading-tight">
                {title}
              </div>
              <div className="text-gray-600 mt-1 font-semibold">
                Copy these into your notebook neatly.
              </div>
            </div>

            {/* Notes */}
            <div className="mt-6 grid gap-3">
              {(bullets.length ? bullets : ["(No notes were provided for this task.)"]).map((bullet, i) => (
                <div
                  key={i}
                  className="rounded-3xl border bg-white/80 shadow-sm px-5 py-4 flex items-start gap-4"
                >
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 border flex items-center justify-center font-black text-indigo-700 shrink-0">
                    {i + 1}
                  </div>

                  <div className={`text-xl md:text-2xl text-gray-900 leading-snug ${writingFont}`}>
                    {String(bullet)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Teacher stamp / callout */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[92%] max-w-3xl">
            <div className="rounded-[2rem] border-4 border-yellow-500 bg-gradient-to-r from-yellow-300 to-amber-300 shadow-2xl px-6 py-5">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-center md:text-left">
                  <div className="text-2xl md:text-3xl font-black text-black">
                    WRITE THIS IN YOUR NOTEBOOK!
                  </div>
                  <div className="text-lg md:text-xl font-extrabold text-black/80 mt-1">
                    {pointsText}
                  </div>
                </div>

                <div className="px-5 py-3 rounded-2xl bg-white border shadow-sm font-black text-lg">
                  ✅ Neat + Complete
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => onSubmit?.({ completed: true })}
          disabled={disabled}
          className="mt-6 w-full max-w-5xl px-8 py-5 text-2xl md:text-3xl font-black bg-green-600 text-white rounded-[2rem] hover:bg-green-700 shadow-2xl disabled:opacity-60"
        >
          I Wrote It Down! ✍️
        </button>
      </div>
    </div>
  );
}
