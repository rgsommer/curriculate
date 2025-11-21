// student-app/src/components/tasks/types/PhotoTask.jsx
import React, { useRef, useState } from "react";

export default function PhotoTask({ task, onSubmit, disabled }) {
  const [note, setNote] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef(null);

  const promptText =
    task?.prompt ||
    "Use your device to take a photo that matches your teacher's instructions.";

  const uiDisabled = disabled || submitted;

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
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (uiDisabled) return;

    const parts = [];
    parts.push(imagePreview ? "[PHOTO TAKEN]" : "[NO PHOTO SELECTED]");
    if (note.trim()) {
      parts.push(`Note: ${note.trim()}`);
    }

    const answerText = parts.join(" ");
    onSubmit(answerText);
    setSubmitted(true);
  };

  return (
    <div
      style={{
        background: "#020617",
        borderRadius: 12,
        padding: 16,
        border: "2px solid #1d4ed8",
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
        Photo Task
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

      {/* Hidden input that opens camera/gallery on mobile */}
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
        Add a note or description (optional):
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
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
