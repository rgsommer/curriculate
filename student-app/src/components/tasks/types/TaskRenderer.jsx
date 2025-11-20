// student-app/src/components/TaskRenderer.jsx
import React, { useState } from "react";

export default function TaskRenderer({ task, onSubmit, answered }) {
  const [value, setValue] = useState("");

  const handleClick = () => {
    if (answered) return;
    onSubmit(value);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontWeight: 600, marginBottom: 6 }}>
        {task?.prompt || "Task"}
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type your answer here…"
        style={{
          width: "100%",
          minHeight: 80,
          padding: 6,
          border: "1px solid #cbd5f5",
          borderRadius: 6,
          marginBottom: 10,
        }}
        disabled={answered}
      />
      <button
        onClick={handleClick}
        disabled={answered}
        style={{
          background: answered ? "#94a3b8" : "#2563eb",
          color: "#fff",
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
