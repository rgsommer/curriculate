// student-app/src/components/tasks/types/PhotoJournalTask.jsx
import React, { useState } from "react";
import PhotoTask from "./PhotoTask";

/**
 * PhotoJournalTask
 *
 * UX:
 * 1) Student uses the normal PhotoTask UI to capture / upload a photo.
 * 2) That submission is intercepted and stored as `photoAnswer` (not yet sent to server).
 * 3) Student writes a short explanation for what is in the photo.
 * 4) When both pieces are present, they hit "Submit Photo Journal" and we send
 *    a combined payload to the parent:
 *
 *    {
 *      type: "photo-journal",
 *      photo: <whatever PhotoTask would normally submit>,
 *      explanation: "<their text>"
 *    }
 *
 * The backend already treats answers as generic JSON blobs, so this preserves
 * all existing behaviour while adding richer context.
 */
export default function PhotoJournalTask({
  task,
  onSubmit,
  disabled = false,
  onAnswerChange,
  answerDraft,
}) {
  const [photoAnswer, setPhotoAnswer] = useState(null);
  const [explanation, setExplanation] = useState(
    (answerDraft && answerDraft.explanation) || ""
  );
  const [photoCaptured, setPhotoCaptured] = useState(false);

  const handleInnerPhotoSubmit = (payload) => {
    // Do NOT call the parent onSubmit yet; just capture the photo payload.
    setPhotoAnswer(payload);
    setPhotoCaptured(true);

    // Optionally let parent know draft changed
    if (onAnswerChange) {
      onAnswerChange({
        ...(answerDraft || {}),
        photo: payload,
        explanation,
      });
    }
  };

  const handleExplanationChange = (e) => {
    const value = e.target.value;
    setExplanation(value);
    if (onAnswerChange) {
      onAnswerChange({
        ...(answerDraft || {}),
        photo: photoAnswer,
        explanation: value,
      });
    }
  };

  const handleFinalSubmit = (e) => {
    e.preventDefault();
    if (disabled) return;
    const trimmed = explanation.trim();
    if (!photoAnswer || !trimmed) return;

    const payload = {
      type: "photo-journal",
      photo: photoAnswer,
      explanation: trimmed,
    };

    if (onSubmit) {
      onSubmit(payload);
    }
  };

  const explanationPlaceholder =
    task?.prompt && task.prompt.trim().length > 0
      ? "Write a short explanation or caption…"
      : "Explain what your photo shows and why it matches the task…";

  const readyToSubmit = !!photoAnswer && explanation.trim().length > 0 && !disabled;

  return (
    <form
      onSubmit={handleFinalSubmit}
      className="space-y-3"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {task?.prompt && (
        <p
          style={{
            marginTop: 0,
            marginBottom: 8,
            fontSize: "0.95rem",
            fontWeight: 500,
          }}
        >
          {task.prompt}
        </p>
      )}

      <div
        style={{
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 10,
          background: "#f9fafb",
        }}
      >
        <div
          style={{
            marginBottom: 6,
            fontSize: "0.9rem",
            fontWeight: 600,
          }}
        >
          Step 1 – Take your photo
        </div>
        <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: 6 }}>
          Use the camera or upload button below to capture evidence for this task.
        </div>

        {/* Re-use the existing PhotoTask, but intercept its submission */}
        <PhotoTask
          task={task}
          disabled={disabled}
          onSubmit={handleInnerPhotoSubmit}
        />

        {photoCaptured && (
          <div
            style={{
              marginTop: 6,
              fontSize: "0.8rem",
              color: "#16a34a",
              fontWeight: 500,
            }}
          >
            ✅ Photo captured! You can retake it if needed, then add your explanation
            below.
          </div>
        )}
      </div>

      <div
        style={{
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 10,
          background: "#ffffff",
        }}
      >
        <div
          style={{
            marginBottom: 6,
            fontSize: "0.9rem",
            fontWeight: 600,
          }}
        >
          Step 2 – Explain your photo
        </div>
        <textarea
          rows={3}
          value={explanation}
          onChange={handleExplanationChange}
          disabled={disabled}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            fontSize: "0.9rem",
            resize: "vertical",
          }}
          placeholder={explanationPlaceholder}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button
          type="submit"
          disabled={!readyToSubmit}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "none",
            background: readyToSubmit ? "#16a34a" : "#9ca3af",
            color: "#ffffff",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: readyToSubmit ? "pointer" : "not-allowed",
          }}
        >
          Submit Photo Journal
        </button>
      </div>
    </form>
  );
}
