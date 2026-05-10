// student-app/src/components/tasks/types/PhotoTask.jsx
import React, { useRef, useState, useEffect } from "react";
import { API_BASE_URL } from "../../../config.js";

// Keyframe animations
const styles = `
@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
  }
}

@keyframes float-in {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin-rotate {
  from {
    transform: rotate(-2deg);
  }
  50% {
    transform: rotate(2deg);
  }
  to {
    transform: rotate(-2deg);
  }
}

@keyframes bounce-scale {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

@keyframes confetti-fall {
  to {
    transform: translateY(600px) rotate(720deg);
    opacity: 0;
  }
}

@keyframes sparkle {
  0%, 100% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
}

@keyframes rainbow-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@keyframes progress-slide {
  from {
    background-position: -100% 0;
  }
  to {
    background-position: 100% 0;
  }
}
`;

// Inject styles into document
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

export default function PhotoTask({ task, onSubmit, disabled, memberNames, remainingMs, timeLimitSeconds }) {
  const [note, setNote] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [confetti, setConfetti] = useState([]);

  // ── AI scoring + coaching feedback (per tester request).
  // After the user taps Submit, we POST the photo + prompt to the
  // /api/evaluate/photo endpoint and surface the score + feedback
  // before passing control back to the parent.  onSubmit only fires
  // once the user reads the feedback and taps Continue, so they
  // actually get to see the AI critique instead of being whisked
  // away to the next task.
  const [evaluating, setEvaluating] = useState(false);
  const [aiScore, setAiScore] = useState(null);
  const [aiHeadline, setAiHeadline] = useState("");
  const [aiFeedback, setAiFeedback] = useState("");
  const [aiError, setAiError] = useState(false);
  const submittedRef = useRef(false);

  const fileRef = useRef(null);
  const containerRef = useRef(null);

  const promptText =
    task?.prompt ||
    "Use your device to take a photo that matches your teacher's instructions.";

  // After Submit, the AI panel takes over.  Lock the camera/textarea
  // /submit button until the user dismisses it via Continue (which
  // sets submitted=true via handleContinue).
  const evaluationActive = evaluating || aiScore != null || !!aiFeedback;
  const uiDisabled = disabled || submitted || evaluationActive;

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

  const triggerConfetti = () => {
    const newConfetti = Array.from({ length: 40 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      duration: 2.5 + Math.random() * 1,
      size: 6 + Math.random() * 12,
      color: ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#38bdf8'][Math.floor(Math.random() * 6)],
    }));
    setConfetti(newConfetti);
    setShowCelebration(true);
    setTimeout(() => setShowCelebration(false), 3000);
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
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Run AI scoring + feedback against the photo + prompt.  Falls
  // back to a friendly default if the endpoint is unreachable.
  const runAiEvaluation = async (dataUrl) => {
    setEvaluating(true);
    setAiError(false);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const resp = await fetch(`${API_BASE_URL}/api/evaluate/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          image: dataUrl,
          prompt: promptText,
          note: note.trim(),
          gradeLevel: task?.gradeLevel || task?.config?.gradeLevel,
        }),
      });
      clearTimeout(timeout);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || typeof data?.score !== "number") {
        throw new Error(data?.error || "Bad response");
      }
      setAiScore(data.score);
      setAiHeadline(data.headline || "Got it!");
      setAiFeedback(data.feedback || "Nice photo! Keep matching the prompt.");
    } catch (err) {
      console.warn("[PhotoTask] AI evaluation failed:", err?.message || err);
      setAiError(true);
      setAiScore(null);
      setAiHeadline("Photo received");
      setAiFeedback(
        "We couldn't reach the AI photo coach this time, but your photo is in. Nice work!"
      );
    } finally {
      setEvaluating(false);
    }
  };

  const handleSubmit = async () => {
    if (uiDisabled) return;

    if (!imagePreview) {
      setErrorMsg("Take a photo first, then press Submit.");
      return;
    }

    setUploading(true);

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

    setUploading(false);
    triggerConfetti();
    // Run the AI vision call against the local data: URL preview.
    // No S3 round-trip needed — it's already in the browser.
    runAiEvaluation(imagePreview);
  };

  // User taps Continue on the AI feedback panel → THEN we hand
  // control back to the parent so the next task can advance.
  const handleContinue = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const parts = ["[PHOTO TAKEN]"];
    if (note.trim()) parts.push(`Note: ${note.trim()}`);
    if (aiScore != null) parts.push(`AI Score: ${aiScore}/100`);
    if (aiFeedback) parts.push(`AI Feedback: ${aiFeedback}`);
    onSubmit(parts.join(" "));
    setSubmitted(true);
  };

  // Calculate time remaining
  const timePercent = remainingMs && timeLimitSeconds
    ? Math.max(0, Math.min(100, (remainingMs / (timeLimitSeconds * 1000)) * 100))
    : 100;

  const timeWarning = remainingMs && remainingMs < 30000;
  const timeCritical = remainingMs && remainingMs < 10000;

  return (
    <div
      ref={containerRef}
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        borderRadius: 16,
        padding: 24,
        border: "2px solid transparent",
        backgroundImage: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%), linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)",
        backgroundClip: "padding-box, border-box",
        backgroundOrigin: "padding-box, border-box",
        color: "#f1f5f9",
        position: "relative",
        overflow: "hidden",
        animation: "float-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* Celebration confetti */}
      {showCelebration && confetti.map(c => (
        <div
          key={c.id}
          style={{
            position: "fixed",
            left: `${c.left}%`,
            top: "-10px",
            width: `${c.size}px`,
            height: `${c.size}px`,
            background: c.color,
            borderRadius: "50%",
            opacity: 0,
            animation: `confetti-fall ${c.duration}s ease-in forwards`,
            animationDelay: `${c.delay}s`,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      ))}

      {/* Success overlay */}
      {submitted && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%)",
            pointerEvents: "none",
            animation: "pulse-glow 2s ease-in-out",
          }}
        />
      )}

      {/* Header with gradient text */}
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            marginTop: 0,
            marginBottom: 12,
            fontSize: "1.5rem",
            fontWeight: 800,
            background: "linear-gradient(135deg, #60a5fa 0%, #34d399 50%, #fbbf24 100%)",
            backgroundSize: "200% 200%",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "rainbow-shift 4s ease infinite",
          }}
        >
          📸 Photo Challenge
        </h2>
        <p
          style={{
            marginTop: 0,
            marginBottom: 0,
            fontSize: "0.9rem",
            color: "#cbd5e1",
            fontStyle: "italic",
          }}
        >
          Show us what you've got!
        </p>
      </div>

      {/* Prompt card with animation */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          border: "1px solid rgba(59, 130, 246, 0.3)",
          animation: "slide-up 0.7s ease-out 0.1s both",
          boxShadow: "inset 0 0 20px rgba(59, 130, 246, 0.1)",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "#60a5fa",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 8,
          }}
        >
          Your Challenge
        </div>
        <p
          style={{
            marginTop: 0,
            marginBottom: 0,
            fontSize: "1.1rem",
            lineHeight: 1.5,
            color: "#e2e8f0",
            fontWeight: 500,
          }}
        >
          {promptText}
        </p>
      </div>

      {/* Timer bar with gradient */}
      {remainingMs !== undefined && timeLimitSeconds && (
        <div
          style={{
            marginBottom: 16,
            animation: "slide-up 0.7s ease-out 0.2s both",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: "0.8rem",
                fontWeight: 700,
                color: timeCritical ? "#ff6b6b" : timeWarning ? "#fbbf24" : "#60a5fa",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              ⏱️ Time Remaining
            </span>
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: timeCritical ? "#ff6b6b" : timeWarning ? "#fbbf24" : "#60a5fa",
              }}
            >
              {Math.ceil(remainingMs / 1000)}s
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: "rgba(30, 41, 59, 0.8)",
              borderRadius: 10,
              overflow: "hidden",
              border: `1px solid ${timeCritical ? "rgba(255, 107, 107, 0.3)" : timeWarning ? "rgba(251, 191, 36, 0.3)" : "rgba(96, 165, 250, 0.3)"}`,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${timePercent}%`,
                background: timeCritical
                  ? "linear-gradient(90deg, #ff6b6b 0%, #ff8787 100%)"
                  : timeWarning
                  ? "linear-gradient(90deg, #fbbf24 0%, #fcd34d 100%)"
                  : "linear-gradient(90deg, #60a5fa 0%, #34d399 100%)",
                transition: "width 0.3s ease, background 0.3s ease",
                borderRadius: 10,
                boxShadow: timeCritical
                  ? "0 0 10px rgba(255, 107, 107, 0.5)"
                  : timeWarning
                  ? "0 0 10px rgba(251, 191, 36, 0.5)"
                  : "0 0 10px rgba(96, 165, 250, 0.5)",
              }}
            />
          </div>
        </div>
      )}

      {/* Instructions card */}
      <div
        style={{
          borderRadius: 12,
          border: "1px solid rgba(148, 163, 184, 0.2)",
          background: "rgba(15, 23, 42, 0.8)",
          padding: 12,
          marginBottom: 16,
          animation: "slide-up 0.7s ease-out 0.3s both",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, color: "#cbd5e1", fontSize: "0.9rem" }}>
          📋 How to do this
        </div>
        <ol
          style={{
            margin: "0 0 0 18px",
            padding: 0,
            lineHeight: 1.6,
            color: "#cbd5e1",
            fontSize: "0.9rem",
          }}
        >
          <li>🎥 Press <b>Open Camera</b> to snap a photo</li>
          <li>✨ Make sure it matches the challenge</li>
          <li>📝 Add a note if you want (optional)</li>
          <li>🚀 Press <b>Submit</b> to complete</li>
        </ol>
      </div>

      {/* Error message */}
      {!!errorMsg && (
        <div
          style={{
            borderRadius: 12,
            border: "1px solid rgba(248, 113, 113, 0.5)",
            background: "rgba(254, 226, 226, 0.1)",
            padding: 12,
            marginBottom: 16,
            color: "#fca5a5",
            fontWeight: 600,
            fontSize: "0.9rem",
            animation: "slide-up 0.4s ease-out",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>⚠️</span>
          {errorMsg}
        </div>
      )}

      {/* Camera button */}
      <button
        type="button"
        onClick={handlePickPhoto}
        disabled={uiDisabled}
        style={{
          display: "block",
          width: "100%",
          padding: "14px 16px",
          borderRadius: 12,
          border: "none",
          background: uiDisabled
            ? "linear-gradient(135deg, #64748b 0%, #475569 100%)"
            : imagePreview
            ? "linear-gradient(135deg, #a78bfa 0%, #c084fc 100%)"
            : "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)",
          color: "#fff",
          fontSize: "1rem",
          fontWeight: 700,
          cursor: uiDisabled ? "default" : "pointer",
          marginBottom: 12,
          transition: "all 0.3s ease",
          position: "relative",
          overflow: "hidden",
          transform: uiDisabled ? "scale(1)" : "scale(1)",
          animation: uiDisabled ? "none" : "bounce-scale 2s ease-in-out infinite",
          boxShadow: uiDisabled
            ? "0 4px 12px rgba(0, 0, 0, 0.3)"
            : imagePreview
            ? "0 0 20px rgba(167, 139, 250, 0.4)"
            : "0 0 20px rgba(59, 130, 246, 0.4)",
          letterSpacing: "0.5px",
        }}
        onMouseEnter={(e) => {
          if (!uiDisabled) {
            e.target.style.transform = "scale(1.02)";
            e.target.style.boxShadow = imagePreview
              ? "0 0 30px rgba(167, 139, 250, 0.6)"
              : "0 0 30px rgba(59, 130, 246, 0.6)";
          }
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = "scale(1)";
          e.target.style.boxShadow = uiDisabled
            ? "0 4px 12px rgba(0, 0, 0, 0.3)"
            : imagePreview
            ? "0 0 20px rgba(167, 139, 250, 0.4)"
            : "0 0 20px rgba(59, 130, 246, 0.4)";
        }}
      >
        {imagePreview ? "📸 Retake Photo" : "🎥 Open Camera / Take Photo"}
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

      {/* Photo preview with polaroid effect */}
      {imagePreview && (
        <div
          style={{
            marginBottom: 16,
            animation: "float-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 10px 40px rgba(0, 0, 0, 0.4), 0 0 20px rgba(59, 130, 246, 0.3)",
              transform: "rotate(-1deg)",
              transition: "transform 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "rotate(0deg) scale(1.02)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "rotate(-1deg)";
            }}
          >
            <img
              src={imagePreview}
              alt="Photo preview"
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxHeight: 280,
                objectFit: "cover",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                textAlign: "center",
                fontSize: "0.8rem",
                color: "#94a3b8",
                marginTop: 8,
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              ✨ READY TO SUBMIT ✨
            </div>
          </div>
        </div>
      )}

      {/* Note textarea */}
      <div
        style={{
          marginBottom: 16,
          animation: "slide-up 0.7s ease-out 0.4s both",
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "0.85rem",
            marginBottom: 6,
            fontWeight: 600,
            color: "#cbd5e1",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          📝 Add a note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={uiDisabled}
          rows={3}
          placeholder="Share details about your photo..."
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(59, 130, 246, 0.3)",
            padding: 12,
            fontSize: "0.9rem",
            background: "rgba(15, 23, 42, 0.8)",
            color: "#e2e8f0",
            resize: "vertical",
            fontFamily: "inherit",
            transition: "all 0.3s ease",
            opacity: uiDisabled ? 0.5 : 1,
            boxShadow: "inset 0 0 10px rgba(59, 130, 246, 0.1)",
          }}
          onFocus={(e) => {
            if (!uiDisabled) {
              e.target.style.boxShadow = "inset 0 0 10px rgba(59, 130, 246, 0.2), 0 0 20px rgba(59, 130, 246, 0.2)";
              e.target.style.borderColor = "rgba(59, 130, 246, 0.6)";
            }
          }}
          onBlur={(e) => {
            e.target.style.boxShadow = "inset 0 0 10px rgba(59, 130, 246, 0.1)";
            e.target.style.borderColor = "rgba(59, 130, 246, 0.3)";
          }}
        />
      </div>

      {/* Submit button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={uiDisabled || !imagePreview || uploading}
        style={{
          display: "block",
          width: "100%",
          padding: "14px 16px",
          borderRadius: 12,
          border: "none",
          background:
            uiDisabled || !imagePreview || uploading
              ? "linear-gradient(135deg, #64748b 0%, #475569 100%)"
              : submitted
              ? "linear-gradient(135deg, #22c55e 0%, #10b981 100%)"
              : "linear-gradient(135deg, #22c55e 0%, #34d399 100%)",
          color: "#fff",
          fontSize: "1.05rem",
          fontWeight: 700,
          cursor: uiDisabled || !imagePreview || uploading ? "default" : "pointer",
          transition: "all 0.3s ease",
          position: "relative",
          overflow: "hidden",
          letterSpacing: "0.5px",
          boxShadow: !imagePreview || uiDisabled || uploading
            ? "0 4px 12px rgba(0, 0, 0, 0.3)"
            : "0 0 25px rgba(34, 197, 94, 0.4)",
          animation: !imagePreview || uiDisabled || uploading ? "none" : submitted ? "pulse-glow 2s ease-in-out" : "none",
        }}
        onMouseEnter={(e) => {
          if (!uiDisabled && imagePreview && !uploading) {
            e.target.style.transform = "scale(1.02)";
            e.target.style.boxShadow = "0 0 35px rgba(34, 197, 94, 0.6)";
          }
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = "scale(1)";
          e.target.style.boxShadow = !imagePreview || uiDisabled || uploading
            ? "0 4px 12px rgba(0, 0, 0, 0.3)"
            : "0 0 25px rgba(34, 197, 94, 0.4)";
        }}
      >
        {submitted ? (
          <span>
            ✨ Submitted! ✨
          </span>
        ) : uploading ? (
          <span>
            📤 Uploading...
          </span>
        ) : (
          <span>
            🚀 Submit Photo
          </span>
        )}
      </button>

      {/* AI evaluation panel — shows after Submit, before Continue. */}
      {(evaluating || aiScore != null || aiFeedback) && !submitted && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.12) 100%)",
            border: "1px solid rgba(96,165,250,0.4)",
            animation: "float-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#93c5fd",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            🤖 AI photo coach
          </div>
          {evaluating ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div
                style={{
                  fontSize: "0.95rem",
                  color: "#cbd5e1",
                  fontWeight: 600,
                }}
              >
                Looking at your photo…
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 4,
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.1)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: "40%",
                    background: "linear-gradient(90deg, #60a5fa, #a78bfa)",
                    animation: "progress-slide 1.4s linear infinite",
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              {aiScore != null && (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: "2rem",
                    fontWeight: 900,
                    color:
                      aiScore >= 90 ? "#34d399" : aiScore >= 70 ? "#fbbf24" : "#f87171",
                    marginBottom: 4,
                    lineHeight: 1.1,
                  }}
                >
                  {aiScore}
                  <span style={{ fontSize: "1rem", color: "#94a3b8", fontWeight: 600 }}>
                    {" "}
                    / 100
                  </span>
                </div>
              )}
              {aiHeadline && (
                <div
                  style={{
                    textAlign: "center",
                    fontWeight: 800,
                    color: "#e2e8f0",
                    marginBottom: 6,
                    fontSize: "1rem",
                  }}
                >
                  {aiHeadline}
                </div>
              )}
              <div
                style={{
                  color: "#cbd5e1",
                  fontSize: "0.9rem",
                  lineHeight: 1.5,
                  textAlign: "center",
                }}
              >
                {aiFeedback}
              </div>
              {aiError && (
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.5)",
                    marginTop: 6,
                    fontStyle: "italic",
                    textAlign: "center",
                  }}
                >
                  (Live AI was unavailable)
                </div>
              )}
              <button
                type="button"
                onClick={handleContinue}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 14,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #22c55e 0%, #34d399 100%)",
                  color: "#fff",
                  fontSize: "1rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.5px",
                  boxShadow: "0 0 20px rgba(34,197,94,0.4)",
                }}
              >
                Continue →
              </button>
            </>
          )}
        </div>
      )}

      {/* Success message — final state after Continue. */}
      {submitted && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
            textAlign: "center",
            animation: "float-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <div
            style={{
              fontSize: "1.3rem",
              marginBottom: 8,
              animation: "bounce-scale 0.6s ease-out",
            }}
          >
            🎉
          </div>
          <div
            style={{
              color: "#86efac",
              fontWeight: 700,
              fontSize: "0.95rem",
            }}
          >
            Great job! Your photo has been submitted.
          </div>
        </div>
      )}
    </div>
  );
}
