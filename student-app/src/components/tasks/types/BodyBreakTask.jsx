import React, { useEffect, useMemo, useState } from "react";

function parseStepsFromPrompt(promptText) {
  const t = String(promptText || "").trim();
  if (!t) return [];

  // Split on patterns like "1)" or "1." or line breaks
  const hasNumbered = /(^|\s)\d+[\)\.]\s/.test(t);
  if (hasNumbered) {
    // Normalize "1) foo 2) bar" into lines
    const normalized = t.replace(/(\d+)[\)\.]\s*/g, "\n$1) ");
    return normalized
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^\d+[\)\.]\s*/, "").trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }

  // Otherwise try splitting by newlines or semicolons
  const lines = t
    .split(/\n|;/g)
    .map((s) => s.trim())
    .filter(Boolean);

  // If it’s still basically one blob, return as a single step
  if (lines.length <= 1) return t ? [{ text: t }] : [];
  return lines.map((text) => ({ text }));
}

export default function BodyBreakTask({ task, onSubmit, disabled }) {
  const handleDone = () => onSubmit?.({ done: true });

  const promptText = String(task?.prompt || "");
  const isJumping =
    /jump/i.test(promptText) || !!task?.movement || !!task?.config?.movement;

  const steps = useMemo(() => {
    const cfgSteps = task?.config?.steps;
    if (Array.isArray(cfgSteps) && cfgSteps.length) {
      return cfgSteps
        .map((s) => ({
          icon: s.icon || s.emoji || null,
          text: String(s.text || s.instruction || "").trim(),
          seconds: Number.isFinite(s.seconds) ? s.seconds : Number.isFinite(s.holdSeconds) ? s.holdSeconds : null,
        }))
        .filter((s) => s.text);
    }
    return parseStepsFromPrompt(promptText);
  }, [task?.config?.steps, promptText]);

  const totalSeconds =
    Number.isFinite(task?.config?.totalSeconds) ? task.config.totalSeconds :
    Number.isFinite(task?.timeLimitSeconds) ? task.timeLimitSeconds :
    null;

  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(totalSeconds);

  useEffect(() => {
    setRunning(false);
    setTimeLeft(totalSeconds);
  }, [totalSeconds, task?._id, task?.id, task?.prompt]);

  useEffect(() => {
    if (!running) return;
    if (!Number.isFinite(timeLeft)) return;
    if (timeLeft <= 0) return;

    const t = setTimeout(() => setTimeLeft((x) => (x == null ? x : x - 1)), 1000);
    return () => clearTimeout(t);
  }, [running, timeLeft]);

  const finishText =
    String(task?.config?.finishText || "").trim() ||
    "Sit back down—ready to continue!";

  return (
    <div className="h-full flex flex-col p-4">
      <style>{`
        @keyframes bb-bounce {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        .bb-jumpers span{
          display:inline-block;
          animation: bb-bounce 0.6s ease-in-out infinite;
        }
      `}</style>

      {/* Top row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="text-3xl">🧘</div>
          <div className="text-left">
            <div className="font-extrabold text-lg leading-tight">Quick reset</div>
            <div className="text-sm text-gray-600">
              {steps.length ? `${steps.length} steps` : "Follow along"}{" "}
              {Number.isFinite(totalSeconds) ? `• ~${totalSeconds}s` : ""}
            </div>
          </div>
        </div>

        {Number.isFinite(totalSeconds) && (
          <div className="px-3 py-1 rounded-full border text-sm font-bold bg-white">
            ⏱ {timeLeft ?? totalSeconds}s
          </div>
        )}
      </div>

      {isJumping && (
        <div className="bb-jumpers mb-3 text-4xl text-center" aria-hidden="true">
          {["🧍‍♂️","🧍‍♀️","🤸","🐸","🦘","😄"].map((e, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.08}s`, margin: "0 6px" }}>
              {e}
            </span>
          ))}
        </div>
      )}

      {/* Steps */}
      <div className="flex-1 min-h-0 overflow-auto">
        {steps.length ? (
          <div className="grid gap-2">
            {steps.map((s, idx) => (
              <div
                key={idx}
                className="rounded-2xl border bg-white px-3 py-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center font-extrabold text-blue-700 shrink-0">
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-base leading-snug">
                      {s.icon ? <span className="mr-2">{s.icon}</span> : null}
                      {s.text}
                    </div>
                    {s.seconds ? (
                      <div className="text-sm text-gray-600 mt-0.5">Hold for {s.seconds}s</div>
                    ) : null}
                  </div>
                </div>

                {s.seconds ? (
                  <div className="text-xs font-bold text-gray-600 px-2 py-1 rounded-full border bg-gray-50 shrink-0">
                    {s.seconds}s
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border bg-white p-4 text-center text-gray-700">
            {promptText || "Stand up, stretch, and reset for a moment."}
          </div>
        )}

        {task?.config?.verification === "timed" && (
          <div className="mt-3 text-sm text-gray-600 text-center">
            Complete it before the timer ends!
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-4 grid gap-2">
        {Number.isFinite(totalSeconds) && (
          <button
            className="w-full rounded-2xl px-3 py-3 font-extrabold border bg-white"
            onClick={() => setRunning((v) => !v)}
            disabled={disabled}
          >
            {running ? "Pause ⏸" : "Start ▶️"}
          </button>
        )}

        <button
          className="w-full rounded-2xl px-3 py-3 font-extrabold border bg-green-600 text-white"
          onClick={handleDone}
          disabled={disabled}
        >
          DONE ✅
        </button>

        <div className="text-xs text-gray-600 text-center">{finishText}</div>
      </div>
    </div>
  );
}
