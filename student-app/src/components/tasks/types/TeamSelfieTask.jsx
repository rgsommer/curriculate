// student-app/src/components/tasks/types/TeamSelfieTask.jsx
import React, { useState, useRef, useCallback, useEffect } from "react";

/**
 * Team Selfie Task — Fun pre-game photo.
 *
 * Opens front-facing camera, team takes a group selfie.
 * Photo is uploaded and becomes the team card + included in reports.
 * On Plus/Pro tiers, after upload the AI generates a themed version
 * based on the taskset subject (history era, lab scene, etc.).
 *
 * No scoring. Submits automatically after capture (+ optional theming).
 */

const API = import.meta.env.VITE_API_URL || "";

export default function TeamSelfieTask({ task, onSubmit, disabled, roomCode, teamId }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // camera | countdown | preview | uploading | theming | done
  const [phase, setPhase] = useState("camera");
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [error, setError] = useState(null);
  const [themedUrl, setThemedUrl] = useState(null);
  const [themingProgress, setThemingProgress] = useState("");

  // Tier config from backend injection
  const allowThemed = task?.config?.allowThemed === true;
  const subject = task?.config?.subject || "";
  const theme = task?.config?.theme || "";

  // Start camera on mount
  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error("[selfie] Camera access failed:", err);
        setError("Could not access camera. Please allow camera permissions and try again.");
      }
    }
    startCamera();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const capturePhoto = useCallback(() => {
    // 3-2-1 countdown then snap
    setPhase("countdown");
    let count = 3;
    setCountdown(count);

    const iv = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(iv);
        setCountdown(null);

        // Snap the photo from video
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 960;
        const ctx = canvas.getContext("2d");

        // Mirror the image (front camera is mirrored)
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setPhotoDataUrl(dataUrl);
        setPhase("preview");
        stopCamera();
      }
    }, 1000);
  }, [stopCamera]);

  const retake = useCallback(() => {
    setPhotoDataUrl(null);
    setThemedUrl(null);
    setPhase("camera");
    setError(null);
    // Restart camera
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    }).catch(() => setError("Could not restart camera."));
  }, []);

  const submitPhoto = useCallback(async () => {
    if (!photoDataUrl) return;
    setPhase("uploading");

    try {
      // Convert data URL to blob
      const resp = await fetch(photoDataUrl);
      const blob = await resp.blob();

      // Get presigned upload URL
      const presignRes = await fetch(`${API}/api/media/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          teamId,
          taskType: "team-selfie",
          purpose: "selfie",
          contentType: "image/jpeg",
        }),
      });
      let presignData;
      try {
        presignData = await presignRes.json();
      } catch {
        throw new Error(`Presign returned ${presignRes.status}: not JSON`);
      }
      if (!presignData.ok || !presignData.uploadUrl) {
        throw new Error(presignData.error || `Presign failed (${presignRes.status})`);
      }

      // Upload to S3
      const putRes = await fetch(presignData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!putRes.ok) {
        throw new Error(`S3 PUT failed: ${putRes.status} ${putRes.statusText}`);
      }

      const photoUrl = presignData.signedGetUrl || presignData.key;
      const selfieKey = presignData.key;

      // If themed images are allowed, generate one
      if (allowThemed && subject) {
        setPhase("theming");
        setThemingProgress("Creating your AI-themed team image...");

        try {
          const themeRes = await fetch(`${API}/api/selfie/generate-themed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomCode, teamId, selfieKey, subject, theme }),
          });
          const themeData = await themeRes.json();

          if (themeData.ok && themeData.themedUrl) {
            setThemedUrl(themeData.themedUrl);
            setThemingProgress("");

            // Wait a moment to show the themed image before auto-submitting
            setPhase("done");
            setTimeout(() => {
              if (onSubmit) {
                onSubmit({
                  photoUrl,
                  selfieKey,
                  themedUrl: themeData.themedUrl,
                  themedKey: themeData.themedKey,
                  autoComplete: true,
                });
              }
            }, 3000); // Show themed image for 3 seconds
            return;
          } else {
            console.warn("[selfie] Themed generation failed:", themeData.error);
            setThemingProgress("");
            // Fall through to submit without themed image
          }
        } catch (themeErr) {
          console.warn("[selfie] Themed generation error:", themeErr);
          setThemingProgress("");
          // Fall through to submit without themed image
        }
      }

      // Submit without themed image (or if theming failed)
      setPhase("done");
      if (onSubmit) {
        onSubmit({
          photoUrl,
          selfieKey,
          autoComplete: true,
        });
      }
    } catch (err) {
      console.error("[selfie] Upload failed:", err.message);
      // Show error briefly, then fall back to local save so warmup continues
      setError(`Upload issue: ${err.message}`);
      setTimeout(() => {
        try {
          localStorage.setItem("curriculate_selfie_url", photoDataUrl);
        } catch (_) { /* storage full — ignore */ }
        setError("");
        setPhase("done");
        if (onSubmit) {
          onSubmit({
            photoUrl: photoDataUrl,
            selfieKey: null,
            autoComplete: true,
            localOnly: true,
          });
        }
      }, 2000); // Show error for 2s then proceed anyway
    }
  }, [photoDataUrl, roomCode, teamId, onSubmit, allowThemed, subject, theme]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "75vh",
      padding: "16px",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes selfieCountdown {
          0% { transform: scale(2); opacity: 0; }
          30% { transform: scale(1); opacity: 1; }
          80% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.5); opacity: 0; }
        }
        @keyframes selfieBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes flashEffect {
          0% { opacity: 0; }
          10% { opacity: 0.8; }
          100% { opacity: 0; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes fadeSlideUp {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: "2.5rem" }}>📸</div>
        <div style={{
          fontSize: "1.3rem",
          fontWeight: 800,
          color: "#f1f5f9",
          marginTop: 4,
        }}>
          Team Selfie!
        </div>
        <div style={{
          fontSize: "0.85rem",
          color: "#94a3b8",
          marginTop: 4,
        }}>
          {phase === "theming"
            ? "Hold tight — AI is working its magic..."
            : "Get everyone in the frame — be fun, be silly, be you!"}
        </div>
      </div>

      {/* Camera / Preview */}
      {(phase === "camera" || phase === "countdown") && (
        <div style={{
          position: "relative",
          width: "100%",
          maxWidth: 400,
          aspectRatio: "4/3",
          borderRadius: 20,
          overflow: "hidden",
          background: "#000",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
            }}
          />

          {/* Countdown overlay */}
          {phase === "countdown" && countdown && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.3)",
            }}>
              <div
                key={countdown}
                style={{
                  fontSize: "6rem",
                  fontWeight: 900,
                  color: "#fff",
                  textShadow: "0 4px 20px rgba(0,0,0,0.5)",
                  animation: "selfieCountdown 0.9s ease-out forwards",
                }}
              >
                {countdown}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Photo preview (original + themed side by side when available) */}
      {(phase === "preview" || phase === "uploading" || phase === "theming" || phase === "done") && photoDataUrl && (
        <div style={{
          display: "flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
          width: "100%",
          maxWidth: themedUrl ? 600 : 400,
        }}>
          {/* Original photo */}
          <div style={{
            position: "relative",
            flex: themedUrl ? "1 1 45%" : "1 1 100%",
            maxWidth: themedUrl ? 280 : 400,
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            transition: "max-width 0.5s ease",
          }}>
            <img
              src={photoDataUrl}
              alt="Team selfie"
              style={{
                width: "100%",
                display: "block",
                borderRadius: 20,
              }}
            />
            {themedUrl && (
              <div style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: "0.7rem",
                fontWeight: 700,
              }}>
                Original
              </div>
            )}
            {phase === "done" && !themedUrl && (
              <div style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.25)",
                borderRadius: 20,
              }}>
                <div style={{
                  fontSize: "3rem",
                  animation: "selfieBounce 1s ease-in-out infinite",
                }}>
                  ✅
                </div>
              </div>
            )}
          </div>

          {/* Themed image */}
          {themedUrl && (
            <div style={{
              position: "relative",
              flex: "1 1 45%",
              maxWidth: 280,
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(14,165,233,0.3)",
              border: "2px solid #0ea5e9",
              animation: "fadeSlideUp 0.6s ease-out forwards",
            }}>
              <img
                src={themedUrl}
                alt="AI-themed team selfie"
                style={{
                  width: "100%",
                  display: "block",
                  borderRadius: 18,
                }}
              />
              <div style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                background: "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
                color: "#fff",
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: "0.7rem",
                fontWeight: 700,
              }}>
                AI Themed ✨
              </div>
            </div>
          )}

          {/* Theming loading placeholder */}
          {phase === "theming" && !themedUrl && (
            <div style={{
              flex: "1 1 45%",
              maxWidth: 280,
              aspectRatio: "1/1",
              borderRadius: 20,
              overflow: "hidden",
              border: "2px dashed #0ea5e9",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(14,165,233,0.05)",
            }}>
              <div style={{
                width: "60%",
                height: 6,
                borderRadius: 3,
                background: "linear-gradient(90deg, #0ea5e9 25%, #8b5cf6 50%, #0ea5e9 75%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 2s linear infinite",
                marginBottom: 12,
              }} />
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>🎨</div>
              <div style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                fontWeight: 600,
                padding: "0 12px",
                textAlign: "center",
              }}>
                {themingProgress || "Generating themed image..."}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 12,
          padding: "10px 16px",
          background: "rgba(239,68,68,0.15)",
          borderRadius: 12,
          border: "1px solid rgba(239,68,68,0.3)",
          color: "#fca5a5",
          fontSize: "0.85rem",
        }}>
          {error}
        </div>
      )}

      {/* Buttons */}
      <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
        {phase === "camera" && (
          <button
            onClick={capturePhoto}
            disabled={disabled || !!error}
            style={{
              background: "linear-gradient(135deg, #ec4899, #f43f5e)",
              border: "none",
              borderRadius: 50,
              padding: "16px 40px",
              color: "#fff",
              fontSize: "1.2rem",
              fontWeight: 800,
              cursor: disabled ? "not-allowed" : "pointer",
              boxShadow: "0 6px 24px rgba(244,63,94,0.4)",
              animation: "selfieBounce 2s ease-in-out infinite",
            }}
          >
            📸 Take Selfie!
          </button>
        )}

        {phase === "preview" && (
          <>
            <button
              onClick={retake}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 14,
                padding: "12px 24px",
                color: "#f1f5f9",
                fontSize: "0.95rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🔄 Retake
            </button>
            <button
              onClick={submitPhoto}
              disabled={disabled}
              style={{
                background: "linear-gradient(135deg, #22c55e, #16a34a)",
                border: "none",
                borderRadius: 14,
                padding: "12px 32px",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 700,
                cursor: disabled ? "not-allowed" : "pointer",
                boxShadow: "0 4px 16px rgba(34,197,94,0.4)",
              }}
            >
              ✅ Use This Photo
            </button>
          </>
        )}

        {phase === "uploading" && (
          <div style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "#94a3b8",
            padding: "12px 24px",
          }}>
            Uploading your team selfie...
          </div>
        )}

        {phase === "theming" && (
          <div style={{
            fontSize: "0.9rem",
            fontWeight: 600,
            color: "#0ea5e9",
            padding: "12px 24px",
          }}>
            AI is creating your themed team image...
          </div>
        )}

        {phase === "done" && (
          <div style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "#22c55e",
            padding: "12px 24px",
          }}>
            {themedUrl ? "Looking great! Get ready to play..." : "Selfie saved! Get ready to play..."}
          </div>
        )}
      </div>
    </div>
  );
}
