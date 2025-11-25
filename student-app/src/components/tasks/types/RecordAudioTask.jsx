// student-app/src/components/RecordAudioTask.jsx
import React from "react";

export default function RecordAudioTask({ task, onSubmit, onAnswerChange, answerDraft }) {
  const handleFakeRecord = () => {
    // later: capture blob and upload
    const payload = {
      correct: true, // or false if you want teacher to review
      basePoints: task.points || 10,
      recorded: true,
    };

    if (onAnswerChange) {
      onAnswerChange(payload);
    }
    onSubmit && onSubmit(payload);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h3>{task.prompt}</h3>
      {task.mediaUrl && (
        <img
          src={task.mediaUrl}
          alt=""
          style={{ maxWidth: "100%", marginTop: 10 }}
        />
      )}
      <p style={{ marginTop: 10, fontSize: "0.8rem" }}>
        Press record and say your answer.
      </p>
      <button
        onClick={handleFakeRecord}
        style={{
          marginTop: 12,
          background: "#0f766e",
          color: "#fff",
          border: "none",
          padding: "8px 14px",
          borderRadius: 6,
        }}
      >
        Record / Submit
      </button>
    </div>
  );
}
