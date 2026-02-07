"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Downscale + JPEG compress for faster uploads / fewer tokens.
// (Vision cost is related to image size; downscaling helps.) :contentReference[oaicite:1]{index=1}
async function downscaleToJpegDataUrl(blob, { maxW = 1280, maxH = 1280, quality = 0.75 } = {}) {
  const img = document.createElement("img");
  const url = URL.createObjectURL(blob);

  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const { width: w0, height: h0 } = img;
    const scale = Math.min(1, maxW / w0, maxH / h0);
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(img, 0, 0, w, h);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function GradingPage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraError, setCameraError] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [shots, setShots] = useState([]); // { id, dataUrl, bytesApprox }
  const [resultJsonText, setResultJsonText] = useState("");
  const [rawText, setRawText] = useState("");

  const totalApproxBytes = useMemo(
    () => shots.reduce((sum, s) => sum + (s.bytesApprox || 0), 0),
    [shots]
  );

  async function startCamera() {
    setCameraError(null);

    // Prefer rear camera on phones
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsCameraOn(true);
    } catch (err) {
      console.error(err);
      setCameraError(
        err?.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access and refresh."
          : "Could not start camera on this device/browser."
      );
      setIsCameraOn(false);
    }
  }

  function stopCamera() {
    try {
      const stream = streamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
    } finally {
      streamRef.current = null;
      setIsCameraOn(false);
    }
  }

  useEffect(() => {
    // Auto-start camera on load (mobile-friendly), but don’t crash SSR.
    if (typeof window !== "undefined" && navigator?.mediaDevices?.getUserMedia) {
      startCamera();
    } else {
      setCameraError("Camera not supported in this browser.");
    }

    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function snapPhoto() {
    setCameraError(null);
    const video = videoRef.current;
    if (!video) return;

    try {
      // Draw current frame to canvas
      const canvas = document.createElement("canvas");
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.drawImage(video, 0, 0, w, h);

      // Convert to Blob then downscale/compress
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      const dataUrl = await downscaleToJpegDataUrl(blob, { maxW: 1280, maxH: 1280, quality: 0.75 });

      // Approx bytes: base64 length * 3/4 (minus prefix)
      const b64 = dataUrl.split(",")[1] || "";
      const bytesApprox = Math.floor((b64.length * 3) / 4);

      setShots((prev) => [
        ...prev,
        { id: crypto.randomUUID(), dataUrl, bytesApprox },
      ]);
    } catch (err) {
      console.error(err);
      setCameraError("Could not capture photo. Try again.");
    }
  }

  function removeShot(id) {
    setShots((prev) => prev.filter((s) => s.id !== id));
  }

  function clearAll() {
    setShots([]);
    setResultJsonText("");
    setRawText("");
  }

  async function submitForGrading() {
    setResultJsonText("");
    setRawText("");
    setCameraError(null);

    if (shots.length === 0) {
      setCameraError("Add at least one photo before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: shots.map((s) => s.dataUrl),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCameraError(data?.error || "Submission failed.");
        return;
      }

      if (data?.json) {
        setResultJsonText(JSON.stringify(data.json, null, 2));
      } else {
        setRawText(data?.raw || "");
      }
    } catch (err) {
      console.error(err);
      setCameraError("Network error submitting for grading.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: "8px 0 4px" }}>Grading Scanner</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Snap multiple photos, then submit for an assessment.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
          <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>Live Camera</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{isCameraOn ? "On" : "Off"}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!isCameraOn ? (
                <button onClick={startCamera} style={btn()}>
                  Start
                </button>
              ) : (
                <button onClick={stopCamera} style={btn({ secondary: true })}>
                  Stop
                </button>
              )}
              <button onClick={snapPhoto} disabled={!isCameraOn || isSubmitting} style={btn({ primary: true, disabled: !isCameraOn || isSubmitting })}>
                Snap Photo
              </button>
            </div>
          </div>

          <div style={{ background: "#000" }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>

          {cameraError && (
            <div style={{ padding: 12, color: "#b00020", fontWeight: 600 }}>
              {cameraError}
            </div>
          )}
        </div>

        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>Captured Photos</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {shots.length} photo(s) • approx upload {formatBytes(totalApproxBytes)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={clearAll} disabled={shots.length === 0 || isSubmitting} style={btn({ secondary: true, disabled: shots.length === 0 || isSubmitting })}>
                Clear
              </button>
              <button onClick={submitForGrading} disabled={shots.length === 0 || isSubmitting} style={btn({ primary: true, disabled: shots.length === 0 || isSubmitting })}>
                {isSubmitting ? "Submitting…" : "Submit for Grading"}
              </button>
            </div>
          </div>

          {shots.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
              {shots.map((s) => (
                <div key={s.id} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, overflow: "hidden", position: "relative" }}>
                  <img src={s.dataUrl} alt="Captured" style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                  <button
                    onClick={() => removeShot(s.id)}
                    disabled={isSubmitting}
                    title="Remove"
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      border: "none",
                      borderRadius: 999,
                      width: 28,
                      height: 28,
                      cursor: "pointer",
                      background: "rgba(0,0,0,0.65)",
                      color: "#fff",
                      fontWeight: 700,
                      lineHeight: "28px",
                      textAlign: "center",
                      opacity: isSubmitting ? 0.5 : 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "#fff" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Assessment Response</div>

          {resultJsonText ? (
            <pre style={pre()}>
              {resultJsonText}
            </pre>
          ) : rawText ? (
            <pre style={pre()}>
              {rawText}
            </pre>
          ) : (
            <div style={{ opacity: 0.7 }}>Submit photos to see the grading JSON here.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function btn({ primary = false, secondary = false, disabled = false } = {}) {
  const bg = primary ? "#111" : secondary ? "#fff" : "#f5f5f5";
  const color = primary ? "#fff" : "#111";
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: secondary ? "1px solid rgba(0,0,0,0.2)" : "1px solid rgba(0,0,0,0.12)",
    background: bg,
    color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    fontWeight: 650,
  };
}

function pre() {
  return {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: 12,
    borderRadius: 10,
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.08)",
    fontSize: 13,
    lineHeight: 1.35,
  };
}
