import React from "react";

export default function BodyBreakTask({ task, onSubmit, disabled }) {
  const handleDone = () => onSubmit({ done: true });

  const prompt = task?.prompt || "";
  const isJumping = /jump|hops?|up\s*and\s*down/i.test(prompt);

  return (
    <div className="p-4 text-center">
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

      <h2 className="font-bold text-2xl mb-3">BODY BREAK!</h2>

      {isJumping && (
        <div className="bb-jumpers mb-3 text-4xl" aria-hidden="true">
          {["🧍‍♂️","🧍‍♀️","🤸","🐸","🦘","😄"].map((e, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.08}s`, margin: "0 6px" }}>
              {e}
            </span>
          ))}
        </div>
      )}

      <p className="mb-4 text-lg">{prompt}</p>

      {task.config?.verification === "timed" && (
        <p className="mb-2 text-sm text-gray-600">Complete it before the timer ends!</p>
      )}

      <button
        className="mt-4 w-full border rounded px-3 py-3 font-bold"
        onClick={handleDone}
        disabled={disabled}
      >
        DONE ✅
      </button>
    </div>
  );
}
