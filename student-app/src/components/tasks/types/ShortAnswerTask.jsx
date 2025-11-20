import React from "react";

/**
 * Short answer task:
 *  - Shows a prompt (scrollable if long)
 *  - Textarea for answer
 *  - Submit button that calls onSubmit(answerString)
 */
export default function ShortAnswerTask({ task, onSubmit, disabled }) {
  const [answer, setAnswer] = React.useState("");

  const handleSubmitClick = () => {
    if (disabled) return;
    onSubmit(answer);
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Prompt – scrollable if long */}
      <div className="font-semibold text-lg max-h-40 overflow-y-auto">
        {task.prompt}
      </div>

      <textarea
        className="border rounded-lg p-2 flex-1 resize-none"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={disabled}
        placeholder="Type your answer here…"
      />

      <button
        type="button"
        onClick={handleSubmitClick}
        disabled={disabled}
        className="mt-2 border rounded-lg px-4 py-2 disabled:opacity-50"
        style={{
          background: disabled ? "#9ca3af" : "#0ea5e9",
          color: "#fff",
          fontWeight: 600,
        }}
      >
        Submit
      </button>
    </div>
  );
}
