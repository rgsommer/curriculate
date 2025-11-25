// student-app/src/components/tasks/types/MultipleChoiceTask.jsx
import React from "react";

/**
 * Multiple choice task:
 *  - Shows prompt (scrollable)
 *  - Shows options as buttons
 *  - Submit button at bottom
 */
export default function MultipleChoiceTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const [selected, setSelected] = React.useState(null);
  const options = Array.isArray(task.options) ? task.options : [];

  const handleSubmitClick = () => {
    if (disabled) return;
    const value =
      selected != null && options[selected] != null
        ? String(options[selected])
        : "";
    onSubmit(value);
  };

  const handleSelect = (idx) => {
    if (disabled) return;
    setSelected(idx);
    if (onAnswerChange && options[idx] != null) {
      onAnswerChange(String(options[idx]));
    }
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="font-semibold text-lg max-h-40 overflow-y-auto">
        {task.prompt}
      </div>

      <div className="flex-1 flex flex-col gap-2">
        {options.map((opt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSelect(idx)}
            disabled={disabled}
            className="w-full text-left border rounded-lg px-3 py-2"
            style={{
              background:
                selected === idx ? "#0ea5e9" : "#f9fafb",
              color: selected === idx ? "#fff" : "#111827",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {opt}
          </button>
        ))}

        {options.length === 0 && (
          <p className="text-sm text-gray-500">
            (No options provided for this multiple-choice task.)
          </p>
        )}
      </div>

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
