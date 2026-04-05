import React, { useRef, useState } from "react";

export default function PaperModeCamera({ task, onSubmit, disabled }) {
  const [note, setNote] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef(null);

  const promptText = task?.prompt || task?.config?.prompt || task?.question || task?.title || "Complete this task on paper, then take a photo.";
  const uiDisabled = disabled || submitted;
  const roomCode = task?.roomCode || task?.config?.roomCode || null;
  const teamId = task?.teamId || task?.config?.teamId || null;

  // S3 presign + upload (same pattern as PhotoTask)
  const presignAndUploadToS3 = async ({ blob, contentType, purpose }) => {
    if (!roomCode || !teamId) throw new Error("Missing roomCode/teamId for S3 upload.");
    const presignResp = await fetch("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode, teamId,
        taskType: task?.taskType || "paper-mode",
        contentType: contentType || blob.type || "application/octet-stream",
        purpose: purpose || "paper-work-photo",
        fileName: `paper-${Date.now()}`,
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

  const handlePickPhoto = () => {
    if (uiDisabled) return;
    if (errorMsg) setErrorMsg("");
    fileRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (errorMsg) setErrorMsg("");
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (uiDisabled) return;
    if (!imagePreview) {
      setErrorMsg("Please take a photo of your work before submitting.");
      return;
    }

    const parts = ["[PAPER MODE]", "[PHOTO TAKEN]"];
    if (note.trim()) parts.push(`Note: ${note.trim()}`);
    const answerText = parts.join(" ");

    let s3 = null;
    try {
      if (imageFile) {
        s3 = await presignAndUploadToS3({
          blob: imageFile,
          contentType: imageFile.type || "image/jpeg",
          purpose: "paper-work-photo",
        });
      }
    } catch (e) {
      console.warn("S3 upload unavailable (PaperModeCamera):", e);
    }

    const enriched = s3?.s3Key ? `${answerText} [S3:${s3.s3Key}]` : answerText;

    // Submit with paperMode flag so backend routes to dedicated AI scorer
    onSubmit({
      answer: enriched,
      paperMode: true,
      originalTaskType: task?.taskType,
      s3Key: s3?.s3Key || null,
    });
    setSubmitted(true);
  };

  return (
    <div style={{
      background: "linear-gradient(135deg, #020617, #1e1b4b)",
      borderRadius: 16,
      padding: 20,
      border: "2px solid #6366f1",
      color: "#e5e7eb",
    }}>
      {/* Header badge */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 999,
        background: "rgba(99,102,241,0.2)",
        border: "1px solid rgba(99,102,241,0.4)",
        fontSize: "0.75rem",
        fontWeight: 700,
        color: "#a5b4fc",
        marginBottom: 12,
        letterSpacing: "0.03em",
      }}>
        <span style={{ fontSize: "0.85rem" }}>&#9997;&#65039;</span> PAPER MODE
      </div>

      <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "1.15rem" }}>
        {task?.title || "Complete on Paper"}
      </h2>

      <div style={{
        borderRadius: 12,
        border: "1px solid rgba(99,102,241,0.3)",
        background: "rgba(99,102,241,0.08)",
        padding: 14,
        marginBottom: 14,
        lineHeight: 1.5,
        fontSize: "0.95rem",
      }}>
        {promptText}
      </div>

      {/* Instructions */}
      <div style={{
        borderRadius: 12,
        border: "1px solid rgba(99,102,241,0.2)",
        background: "rgba(255,255,255,0.04)",
        padding: 12,
        marginBottom: 14,
      }}>
        <div style={{ fontWeight: 800, marginBottom: 6, fontSize: "0.9rem" }}>How to complete</div>
        <ol style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.5, fontSize: "0.88rem" }}>
          <li>Write your answer on a separate piece of paper.</li>
          <li>When finished, press <b>Take Photo</b> below.</li>
          <li>Make sure the photo is clear and all your work is visible.</li>
          <li>Press <b>Submit</b>.</li>
        </ol>
      </div>

      {/* Task-specific items display (e.g., MC options, vocabulary words) */}
      {task?.items && Array.isArray(task.items) && task.items.length > 0 && (
        <div style={{
          borderRadius: 12,
          border: "1px solid rgba(99,102,241,0.2)",
          background: "rgba(255,255,255,0.04)",
          padding: 12,
          marginBottom: 14,
        }}>
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: "0.9rem" }}>Questions / Items</div>
          {task.items.map((item, i) => (
            <div key={item?.id || i} style={{
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              marginBottom: 6,
              fontSize: "0.9rem",
              lineHeight: 1.4,
            }}>
              <span style={{ fontWeight: 700, marginRight: 6 }}>{i + 1}.</span>
              {item?.prompt || item?.question || item?.text || item?.word || JSON.stringify(item)}
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {!!errorMsg && (
        <div style={{
          borderRadius: 12,
          border: "1px solid rgba(248,113,113,0.45)",
          background: "rgba(254,226,226,0.12)",
          padding: 10,
          marginBottom: 12,
          color: "#fecaca",
          fontWeight: 800,
        }}>
          {errorMsg}
        </div>
      )}

      {/* Camera button */}
      <button
        type="button"
        onClick={handlePickPhoto}
        disabled={uiDisabled}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "14px 16px",
          borderRadius: 12,
          border: "none",
          background: uiDisabled ? "#64748b" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "#fff",
          fontSize: "1rem",
          fontWeight: 700,
          cursor: uiDisabled ? "default" : "pointer",
          marginBottom: 12,
          boxShadow: uiDisabled ? "none" : "0 4px 14px rgba(99,102,241,0.4)",
        }}
      >
        <span style={{ fontSize: "1.2rem" }}>&#128247;</span>
        {imagePreview ? "Retake Photo" : "Take Photo of Your Work"}
      </button>

      {/* Hidden file input */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Image preview */}
      {imagePreview && (
        <div style={{
          marginBottom: 12,
          borderRadius: 12,
          overflow: "hidden",
          border: "2px solid rgba(99,102,241,0.4)",
        }}>
          <img
            src={imagePreview}
            alt="Your work"
            style={{
              display: "block",
              width: "100%",
              maxHeight: 300,
              objectFit: "cover",
            }}
          />
        </div>
      )}

      {/* Optional note */}
      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4, color: "#a5b4fc" }}>
        Add a note (optional):
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={uiDisabled}
        rows={2}
        placeholder="e.g., I used long division for #3..."
        style={{
          width: "100%",
          borderRadius: 10,
          border: "1px solid rgba(99,102,241,0.3)",
          padding: 10,
          fontSize: "0.9rem",
          background: "rgba(255,255,255,0.06)",
          color: "#e5e7eb",
          resize: "vertical",
          marginBottom: 14,
        }}
      />

      {/* Submit button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={uiDisabled || !imagePreview}
        style={{
          display: "block",
          width: "100%",
          padding: "14px 16px",
          borderRadius: 12,
          border: "none",
          background: uiDisabled || !imagePreview ? "#64748b" : "linear-gradient(135deg, #22c55e, #16a34a)",
          color: "#fff",
          fontSize: "1.05rem",
          fontWeight: 700,
          cursor: uiDisabled || !imagePreview ? "default" : "pointer",
          boxShadow: uiDisabled || !imagePreview ? "none" : "0 4px 14px rgba(34,197,94,0.35)",
        }}
      >
        {submitted ? "Submitted" : "Submit Photo"}
      </button>
    </div>
  );
}
