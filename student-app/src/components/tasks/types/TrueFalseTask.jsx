import React from "react";

/**
 * True/False task:
 *  - Prompt
 *  - Two buttons: True / False
 *  - Submit button that sends "true" or "false" (string)
 */
export default function TrueFalseTask({
  task,
  onSubmit,
  disabled,
}) {
  const [selected, setSelected] = React.useState(null); // "true" | "false" | null

  const handleSubmitClick = () => {
    if (disabled) return;
    const value = selected === null ? "" : selected;
    onSubmit(value);
  };

  const select = (val) => {
    if (disabled) return;
    setSelected(val);
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="font-semibold text-lg max-h-40 overflow-y-auto">
        {task.prompt}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => select("true")}
          disabled={disabled}
          className="flex-1 border rounded-lg px-3 py-2"
          style={{
            background:
              selected === "true" ? "#16a34a" : "#f9fafb",
            color: selected === "true" ? "#fff" : "#111827",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          True
        </button>
        <button
          type="button"
          onClick={() => select("false")}
          disabled={disabled}
          className="flex-1 border rounded-lg px-3 py-2"
          style={{
            background:
              selected === "false" ? "#dc2626" : "#f9fafb",
            color: selected === "false" ? "#fff" : "#111827",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          False
        </button>
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
