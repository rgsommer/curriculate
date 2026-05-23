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
    const normalized =
      typeof payload === "string" ? { type: "photo", summary: payload } : payload;
    setPhotoAnswer(normalized);
    setPhotoCaptured(true);

    if (onAnswerChange) {
      onAnswerChange({
        ...(answerDraft || {}),
        photo: normalized,
        explanation,
      });
    }

    // Tester report (May 2026): 'after photo is submitted, it should
    // not ask for additional comment on the photo. just one is fine.'
    // PhotoTask already collects a caption — auto-submit the journal
    // entry using that caption rather than forcing a second textarea.
    if (onSubmit && !disabled) {
      onSubmit({
        type: "photo-journal",
        photo: normalized,
        // Preserve the inner caption as the explanation so existing
        // back-end consumers (which read `explanation`) keep working.
        explanation:
          (typeof normalized?.summary === "string" && normalized.summary.trim()) ||
          (typeof normalized?.caption === "string" && normalized.caption.trim()) ||
          "(photo submitted)",
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
      <div
        style={{
          borderRadius: 12,
          border: "1px solid rgba(15,23,42,0.10)",
          background: "linear-gradient(135deg, rgba(239,246,255,0.95), rgba(255,255,255,0.92))",
          padding: 10,
        }}
      >
        <div style={{ fontWeight: 900, color: "#0f172a" }}>How to do this task</div>
        <ol style={{ margin: "6px 0 0 18px", padding: 0, color: "#334155", fontSize: "0.9rem", lineHeight: 1.35, fontWeight: 600 }}>
          <li>Take a photo that matches the prompt.</li>
          <li>Write 1–2 clear sentences explaining your photo.</li>
          <li>Press <b>Submit Photo Journal</b>.</li>
        </ol>
      </div>

      {task?.prompt && (
        <p
          style={{
            marginTop: 0,
            marginBottom: 8,
            fontSize: "0.95rem",
            fontWeight: 700,
            color: "#991b1b",
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
        <div style={{ fontSize: "0.8rem", color: "#374151", marginBottom: 6 }}>
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

      {/* Step 2 textarea + Submit button removed.
          Tester (Gavy, May 2026): 'I think I could still see the
          additional comment box. not needed. only one (the first).'
          PhotoTask.jsx already collects a caption; that caption is
          auto-promoted to the journal `explanation` inside
          handleInnerPhotoSubmit and the journal auto-submits as soon
          as the photo+caption is sent. No second prompt or button
          should appear. */}
    </form>
  );
}
