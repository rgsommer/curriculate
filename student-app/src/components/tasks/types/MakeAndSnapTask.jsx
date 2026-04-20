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
  const [imageFile, setImageFile] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Some demo placeholders accidentally ship the "not in the pool" message to students.
  // This task should NEVER show that. If we detect it, we replace it with a real prompt + clear instructions.
  const isPoolPlaceholder =
    typeof task?.prompt === "string" &&
    /demo task\s+isn['']t\s+in\s+the\s+pool\s+yet/i.test(task.prompt);

  const inferredTopic =
    String(
      task?.config?.topic ||
        task?.config?.unit ||
        task?.config?.unitTitle ||
        task?.config?.lesson ||
        task?.topic ||
        task?.unit ||
        task?.title ||
        ""
    ).trim();

  const makePrompt =
    String(
      task?.config?.makePrompt ||
        task?.config?.buildPrompt ||
        task?.config?.creationPrompt ||
        task?.makePrompt ||
        task?.buildPrompt ||
        (isPoolPlaceholder ? "" : task?.prompt) ||
        ""
    ).trim();

  const promptText =
    makePrompt ||
    (inferredTopic
      ? `Make something that shows this idea: ${inferredTopic}`
      : "Make something that shows the main idea from today's lesson.");

  const instructionsText =
    String(
      task?.config?.instructions ||
        task?.config?.studentInstructions ||
        task?.instructions ||
        (isPoolPlaceholder
          ? ""
          : "Build, arrange, or create what the prompt asks. Then take a photo of what you made.") ||
        ""
    ).trim() ||
    "Work as a team. Build, arrange, or draw what the prompt asks. Then take a clear photo and explain how it matches.";

  // Optional: words/terms provided by the AI/teacher (so students can actually use them).
  const wordsProvided = React.useMemo(() => {
    const raw =
      task?.config?.words ||
      task?.config?.terms ||
      task?.words ||
      task?.terms ||
      task?.wordBank ||
      task?.config?.wordBank ||
      null;

    if (Array.isArray(raw)) return raw.map((w) => String(w).trim()).filter(Boolean);
    if (typeof raw === "string") {
      return raw
        .split(/[,\n]/g)
        .map((w) => String(w).trim())
        .filter(Boolean);
    }
    return [];
  }, [task]);

  const uiDisabled = disabled || submitted || uploading;


  const notePrompt =
    task?.config?.notePrompt ||
    task?.notePrompt ||
    "Write 1–2 sentences describing what you made and why it matches the prompt.";

  const roomCode = task?.roomCode || task?.config?.roomCode || null;
  const teamId = task?.teamId || task?.config?.teamId || null;

  const presignAndUploadToS3 = async ({ blob, contentType, purpose }) => {
    if (!roomCode || !teamId) throw new Error("Missing roomCode/teamId for S3 upload.");

    const presignResp = await fetch("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode,
        teamId,
        taskType: "make-and-snap",
        contentType: contentType || blob.type || "application/octet-stream",
        purpose: purpose || "image",
        fileName: `make-and-snap-${Date.now()}`,
      }),
    });

    const presignJson = await presignResp.json().catch(() => null);
    if (!presignResp.ok || !presignJson?.uploadUrl || !presignJson?.key) {
      throw new Error(presignJson?.error || "Presign failed.");
    }

    const putResp = await fetch(presignJson.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType || blob.type || "application/octet-stream" },
      body: blob,
    });

    if (!putResp.ok) throw new Error("Upload to S3 failed.");

    return { s3Key: presignJson.key, signedGetUrl: presignJson.signedGetUrl || null };
  };


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
    fileRef.current?.click(); // triggers camera/gallery; on mobile with `capture` this prefers camera
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
      pushDraftIfNeeded(note, true);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (uiDisabled) return;

    if (!imagePreview) {
      alert("Please take a photo of what you made before submitting.");
      return;
    }

    setUploading(true);

    const answerText = buildAnswerText(note, true);

    // Upload image to S3 first — sending raw base64 through the socket
    // exceeds Socket.IO's message size limit and silently fails.
    let s3 = null;
    try {
      if (imageFile) {
        s3 = await presignAndUploadToS3({
          blob: imageFile,
          contentType: imageFile.type || "image/jpeg",
          purpose: "image",
        });
      }
    } catch (e) {
      console.warn("S3 upload unavailable (MakeAndSnap), continuing without key:", e);
    }

    // Submit lightweight string answer (S3 key reference, not raw base64)
    const enriched = s3?.s3Key
      ? `${answerText} [S3:${s3.s3Key}]`
      : answerText;

    onSubmit?.(enriched);
    setSubmitted(true);
    setUploading(false);
  };

  const handleNoteChange = (e) => {
    const next = e.target.value;
    setNote(next);
    pushDraftIfNeeded(next, !!imagePreview);
  };

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 18,
        padding: 16,
        border: "1px solid rgba(255,255,255,0.14)",
        background:
          "radial-gradient(1200px 520px at 30% 0%, rgba(56,189,248,0.16), rgba(15,23,42,0.74) 55%, rgba(2,6,23,0.88))",
        color: "#e5e7eb",
        overflow: "hidden",
      }}
    >
      {/* soft glow */}
      <div
        style={{
          position: "absolute",
          inset: "-40% -10% auto -10%",
          height: 240,
          background:
            "radial-gradient(circle at 30% 50%, rgba(34,197,94,0.18), rgba(59,130,246,0.12), transparent 60%)",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <h2
          style={{
            marginTop: 0,
            marginBottom: 8,
            fontSize: "1.25rem",
            fontWeight: 1000,
            letterSpacing: 0.2,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span aria-hidden="true">📸</span>
          Make It & Snap It
        </h2>
      </div>

      {/* Clear, explicit on-screen directions (Grade 7 reading level) */}
      <div
        style={{
          marginTop: 0,
          marginBottom: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            padding: 12,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 6, color: "#fff" }}>
            ✅ Instructions
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.35, fontSize: "0.95rem" }}>
            <li>{instructionsText}</li>
            <li>Take a clear photo that shows the full thing you made.</li>
            <li>Write 2–4 sentences explaining how your photo matches the prompt.</li>
          </ul>
          {/* Camera JSON debug hint removed — was exposing developer data to students */}
        </div>

        <div
          style={{
            padding: 12,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 6, color: "#fff" }}>
            🎯 Prompt (make this)
          </div>
          <div
            style={{
              fontSize: "1rem",
              lineHeight: 1.35,
              fontWeight: 1000,
              color: "#ef4444", // red
            }}
          >
            {promptText}
          </div>
          {isPoolPlaceholder && (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
              (Demo note: a missing-demo prompt was auto-fixed on this device.)
            </div>
          )}
        </div>
      </div>

      {wordsProvided.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 8, color: "#fff" }}>Words provided</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {wordsProvided.slice(0, 24).map((w, i) => (
              <span
                key={`${w}-${i}`}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontWeight: 900,
                  background: "rgba(15,23,42,0.55)",
                  border: "1px solid rgba(148,163,184,0.5)",
                  color: "#e5e7eb",
                  fontSize: 13,
                }}
              >
                {w}
              </span>
            ))}
          </div>
          {wordsProvided.length > 24 && (
            <div style={{ marginTop: 8, opacity: 0.8, fontWeight: 800, fontSize: 12 }}>
              (+{wordsProvided.length - 24} more)
            </div>
          )}
        </div>
      )}

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
        {imagePreview ? "Retake Photo" : "Open Camera / Take Photo"}
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
        {notePrompt}
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
        disabled={uiDisabled || !imagePreview || !note.trim()}
        style={{
          display: "block",
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: "none",
          background:
            uiDisabled || !imagePreview ? "#64748b" : "#22c55e",
          color: "#fff",
          fontSize: "1rem",
          fontWeight: 600,
          cursor:
            uiDisabled || !imagePreview ? "default" : "pointer",
        }}
      >
        {submitted ? "Submitted" : uploading ? "Uploading…" : "Submit"}
      </button>
    </div>
  );
}
