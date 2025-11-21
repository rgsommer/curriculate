// student-app/src/components/tasks/types/DrawMimeTask.jsx
import React, { useState } from "react";

export default function DrawMimeTask({ task, onSubmit, disabled }) {
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const promptText =
    task?.prompt ||
    "Follow the teacher's instructions to draw or mime the idea. Then briefly describe what you did.";

  const uiDisabled = disabled || submitted;

  const handleSubmit = () => {
    if (uiDisabled) return;

    const text = description.trim() || "(no description provided)";
    const answerText = `[DRAW/MIME] ${text}`;
    onSubmit(answerText);
    setSubmitted(true);
  };

  return (
    <div
      style={{
        background: "#020617",
        borderRadius: 12,
        padding: 16,
        border: "2px solid #a855f7",
        color: "#e5e7eb",
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: 8,
          fontSize: "1.15rem",
        }}
      >
        Draw / Mime Task
      </h2>

      <p
        style={{
          marginTop: 0,
          marginBottom: 12,
          fontSize: "0.95rem",
          lineHeight: 1.4,
        }}
      >
        {promptText}
      </p>

      <p
        style={{
          marginTop: 0,
          marginBottom: 8,
          fontSize: "0.85rem",
          color: "#9ca3af",
        }}
      >
        Use paper / whiteboard to draw, or act it out for your team. When
        you&apos;re done, type a short description below so the teacher knows
        what you did.
      </p>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={uiDisabled}
        rows={4}
        placeholder="Example: We drew the microscope with all its parts labeled and mimed how the light travels through it."
        style={{
          width: "100%",
          borderRadius: 8,
          border: "1px solid #4b5563",
          padding: 8,
          fontSize: "0.9rem",
          background: "#020617",
          color: "#e5e7eb",
          resize: "vertical",
          marginBottom: 12,
        }}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={uiDisabled}
        style={{
          display: "block",
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: "none",
          background: uiDisabled ? "#64748b" : "#22c55e",
          color: "#fff",
          fontSize: "1rem",
          fontWeight: 600,
          cursor: uiDisabled ? "default" : "pointer",
        }}
      >
        {submitted ? "Submitted" : "Submit"}
      </button>
    </div>
  );
}
