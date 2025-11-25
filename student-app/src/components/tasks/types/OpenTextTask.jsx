// student-app/src/components/tasks/types/OpenTextTask.jsx
import React, { useEffect, useState } from "react";

export default function OpenTextTask({
  task,
  onSubmit,
  answered,
  onAnswerChange,
  answerDraft,
}) {
  const [value, setValue] = useState(answerDraft ?? "");

  // reset when a new task comes in or answerDraft changes
  useEffect(() => {
    setValue(answerDraft ?? "");
  }, [task?.prompt, task?.id, answerDraft]);

  const handleClick = () => {
    if (answered) return; // don’t double-submit
    const payload = {
      correct: false, // manual review
      basePoints: task.points || 0,
      response: value,
    };
    onSubmit && onSubmit(payload);
    setValue(""); // clear after submit
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setValue(next);
    if (onAnswerChange) {
      onAnswerChange({
        correct: false,
        basePoints: task.points || 0,
        response: next,
      });
    }
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
        onChange={handleChange}
        placeholder={
          answered
            ? "Submitted. Waiting for next task…"
            : "Type your answer…"
        }
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
