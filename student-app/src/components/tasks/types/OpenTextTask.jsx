import React, { useEffect, useState } from "react";

export default function OpenTextTask({ task, onSubmit, answered }) {
  const [value, setValue] = useState("");

  // reset when a new task comes in
  useEffect(() => {
    setValue("");
  }, [task?.prompt, task?.id]);

  const handleClick = () => {
    if (answered) return; // don’t double-submit
    onSubmit &&
      onSubmit({
        correct: false, // manual review
        basePoints: task.points || 0,
        response: value,
      });
    setValue(""); // clear after submit
  };

  return (
    <div style={{ marginTop: 16, opacity: answered ? 0.7 : 1 }}>
      <h3>{task.prompt}</h3>
      {task.mediaUrl && (
        <img
          src={task.mediaUrl}
          alt=""
          style={{ maxWidth: "100%", marginTop: 10 }}
        />
      )}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={answered ? "Submitted. Waiting for next task…" : "Type your answer…"}
        disabled={answered}
        style={{
          width: "100%",
          minHeight: 90,
          marginTop: 12,
          padding: 6,
          background: answered ? "#f1f5f9" : "#fff",
        }}
      />
      <button
        onClick={handleClick}
        disabled={answered}
        style={{
          marginTop: 10,
          background: answered ? "#cbd5e1" : "#2563eb",
          color: answered ? "#475569" : "#fff",
          border: "none",
          padding: "6px 12px",
          borderRadius: 6,
          cursor: answered ? "not-allowed" : "pointer",
        }}
      >
        {answered ? "Submitted" : "Submit"}
      </button>
    </div>
  );
}
