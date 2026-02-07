// student-app/src/components/tasks/types/PhotoTask.jsx
import React, { useRef, useState } from "react";

export default function PhotoTask({ task, onSubmit, disabled }) {
  const [note, setNote] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const fileRef = useRef(null);

  const promptText =
    task?.prompt ||
    "Use your device to take a photo that matches your teacher's instructions.";

  const uiDisabled = disabled || submitted;


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
        taskType: "photo",
        contentType: contentType || blob.type || "application/octet-stream",
        purpose: purpose || "image",
        fileName: `photo-${Date.now()}`,
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
    fileRef.current?.click(); // will open camera on most mobile browsers
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (errorMsg) setErrorMsg("");

    setImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (uiDisabled) return;

    if (!imagePreview) {
      setErrorMsg("Take a photo first, then press Submit.");
      // alert kept for older flows (but we now show an on-screen message)
      // alert("Please take a photo before submitting.");
      return;
    }

    const parts = [];
    parts.push("[PHOTO TAKEN]");
    if (note.trim()) {
      parts.push(`Note: ${note.trim()}`);
    }

    const answerText = parts.join(" ");

    // Prefer S3 upload; fall back to legacy (no media attachment) if unavailable.
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
      console.warn("S3 upload unavailable (PhotoTask), continuing without key:", e);
    }

    const enriched = s3?.s3Key
      ? `${answerText} [S3:${s3.s3Key}]`
      : answerText;

    onSubmit(enriched);
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

      <div
        style={{
          borderRadius: 12,
          border: "1px solid rgba(29,78,216,0.35)",
          background: "rgba(239,246,255,0.12)",
          padding: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>How to do this task</div>
        <ol style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.35 }}>
          <li>Press <b>Open Camera / Take Photo</b>.</li>
          <li>Take a clear photo that matches your teacher’s instructions.</li>
          <li>If you want, add a short note.</li>
          <li>Press <b>Submit</b>.</li>
        </ol>
      </div>

      {!!errorMsg && (
        <div
          style={{
            borderRadius: 12,
            border: "1px solid rgba(248,113,113,0.45)",
            background: "rgba(254,226,226,0.12)",
            padding: 10,
            marginBottom: 12,
            color: "#fecaca",
            fontWeight: 800,
          }}
        >
          {errorMsg}
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
        disabled={uiDisabled || !imagePreview}
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
        {submitted ? "Submitted" : "Submit"}
      </button>
    </div>
  );
}
