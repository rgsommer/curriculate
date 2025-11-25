// student-app/src/components/tasks/types/MakeAndSnapTask.jsx
import React, { useRef, useState } from "react";

export default function MakeAndSnapTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const [note, setNote] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef(null);

  const promptText =
    task?.prompt ||
    "Build, arrange, or create the object as instructed. Then take a photo of what you made.";

  const uiDisabled = disabled || submitted;

  const buildAnswerText = (noteValue, hasPhoto) => {
    const parts = [];
    parts.push("[MAKE-AND-SNAP]");
    parts.push(hasPhoto ? "[PHOTO TAKEN]" : "[NO PHOTO SELECTED]");
    if (noteValue.trim()) {
      parts.push(`Note: ${noteValue.trim()}`);
    }
    return parts.join(" ");
  };

  const pushDraftIfNeeded = (noteValue, hasPhoto) => {
    if (!onAnswerChange) return;
    const answerText = buildAnswerText(noteValue, hasPhoto);
    onAnswerChange(answerText);
  };

  const handlePickPhoto = () => {
    if (uiDisabled) return;
    fileRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
      pushDraftIfNeeded(note, true);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (uiDisabled) return;

    const answerText = buildAnswerText(note, !!imagePreview);
    onSubmit(answerText);
    setSubmitted(true);
  };

  const handleNoteChange = (e) => {
    const next = e.target.value;
    setNote(next);
    pushDraftIfNeeded(next, !!imagePreview);
  };

  return (
    <div
      style={{
        background: "#020617",
        borderRadius: 12,
        padding: 16,
        border: "2px solid #22c55e",
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
        Make & Snap Task
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

      <button
        type="button"
        onClick={handlePickPhoto}
        disabled={uiDisabled}
        style={{
          display: "block",
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: "none",
          background: uiDisabled ? "#64748b" : "#0ea5e9",
          color: "#fff",
          fontSize: "0.95rem",
          fontWeight: 600,
          cursor: uiDisabled ? "default" : "pointer",
          marginBottom: 10,
        }}
      >
        {imagePreview ? "Retake Photo" : "Open Camera / Pick Photo"}
      </button>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {imagePreview && (
        <div
          style={{
            marginBottom: 10,
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid #1f2937",
          }}
        >
          <img
            src={imagePreview}
            alt="Preview"
            style={{
              display: "block",
              width: "100%",
              maxHeight: 240,
              objectFit: "cover",
            }}
          />
        </div>
      )}

      <label
        style={{
          display: "block",
          fontSize: "0.85rem",
          marginBottom: 4,
        }}
      >
        Briefly describe what you made (optional):
      </label>
      <textarea
        value={note}
        onChange={handleNoteChange}
        disabled={uiDisabled}
        rows={3}
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
