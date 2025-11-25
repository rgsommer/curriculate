// student-app/src/components/tasks/types/ShortAnswerTask.jsx
import React from "react";

/**
 * Short answer task:
 *  - Shows a prompt (scrollable if long)
 *  - Textarea for answer
 *  - Submit button that calls onSubmit(answerString)
 */
export default function ShortAnswerTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const [answer, setAnswer] = React.useState(answerDraft ?? "");

  React.useEffect(() => {
    setAnswer(answerDraft ?? "");
  }, [task?.id, task?.prompt, answerDraft]);

  const handleSubmitClick = () => {
    if (disabled) return;
    onSubmit(answer);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setAnswer(next);
    if (onAnswerChange) {
      onAnswerChange(next);
    }
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
        onChange={handleChange}
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
