import React from "react";

export default function BodyBreakTask({ task, onSubmit, disabled }) {
  const handleDone = () => {
    onSubmit({ done: true });
  };

  return (
    <div className="p-4 text-center">
      <h2 className="font-bold text-2xl mb-3">BODY BREAK!</h2>
      <p className="mb-4 text-lg">{task.prompt}</p>

      {task.config?.verification === "timed" && (
        <p className="mb-2 text-sm text-gray-600">
          Complete it before the timer ends!
        </p>
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
