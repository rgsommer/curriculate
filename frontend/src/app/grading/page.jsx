"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Drop-in Next.js App Router page:
 *   app/grading/page.jsx
 *
 * Requires:
 *   NEXT_PUBLIC_BACKEND_URL=https://api.curriculate.net   (set in Vercel, redeploy)
 *
 * Expects backend endpoint:
 *   POST {BACKEND}/grading
 *   Body JSON: { images: [dataUrlJpeg...], meta: { ... } }
 *   Returns JSON (assessment object)
 */

const DEFAULT_MAX_W = 1400; // reduce if you still hit payload limits
const DEFAULT_QUALITY = 0.72;

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

async function compressDataUrlToJpeg(dataUrl, maxW = DEFAULT_MAX_W, quality = DEFAULT_QUALITY) {
  const img = new Image();
  img.src = dataUrl;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default function GradingPage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const isMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [usingFrontCamera, setUsingFrontCamera] = useState(false);

  const [flash, setFlash] = useState(false);
  const [photos, setPhotos] = useState([]); // { id, dataUrl, createdAt }
  const [busyCapture, setBusyCapture] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);
  const [rawResponse, setRawResponse] = useState("");

  const backendBase = useMemo(
    () => stripTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_URL),
    []
  );

  const gradingUrl = useMemo(() => {
    if (!backendBase) return "";
    return `${backendBase}/api/grading`;
  }, [backendBase]);

  function triggerFlash() {
    setFlash(true);
    if (navigator.vibrate) navigator.vibrate(25);
    window.setTimeout(() => setFlash(false), 120);
  }

  async function stopCamera() {
    setCameraReady(false);
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera({ front = false } = {}) {
    setCameraError("");
    setCameraReady(false);

    await stopCamera();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not supported in this browser.");
      }

      // Prefer environment camera for document capture
      const constraints = {
        video: {
          facingMode: front ? "user" : "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS Safari needs these sometimes:
        videoRef.current.playsInline = true;
        await videoRef.current.play();
      }

      setCameraReady(true);
    } catch (err) {
      console.error("Camera start error:", err);
      setCameraError(err?.message || "Could not start camera.");
    }
  }

  useEffect(() => {
    // Start camera on mount
    startCamera({ front: false });
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function capturePhoto() {
    if (!cameraReady || !videoRef.current || !canvasRef.current) return;
    if (busyCapture) return;

    setBusyCapture(true);
    setSubmitError("");
    setResult(null);
    setRawResponse("");

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Desired aspect ratio for capture
      const targetAspect = isMobile ? 3 / 4 : 16 / 9;

      // Compute crop to match preview aspect
      let cropW = vw;
      let cropH = Math.round(vw / targetAspect);

      if (cropH > vh) {
        cropH = vh;
        cropW = Math.round(vh * targetAspect);
      }

      const sx = Math.round((vw - cropW) / 2);
      const sy = Math.round((vh - cropH) / 2);

      canvas.width = cropW;
      canvas.height = cropH;

      ctx.drawImage(
        video,
        sx,
        sy,
        cropW,
        cropH,
        0,
        0,
        cropW,
        cropH
      );

      const rawDataUrl = canvas.toDataURL("image/jpeg", 0.9);

      triggerFlash();

      // Compress/downscale for transport reliability
      const compressed = await compressDataUrlToJpeg(rawDataUrl, DEFAULT_MAX_W, DEFAULT_QUALITY);

      setPhotos((prev) => [
        ...prev,
        { id: crypto.randomUUID(), dataUrl: compressed, createdAt: Date.now() },
      ]);
    } catch (err) {
      console.error("Capture error:", err);
      setSubmitError(err?.message || "Failed to capture photo.");
    } finally {
      setBusyCapture(false);
    }
  }

  function removePhoto(id) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function clearAll() {
    setPhotos([]);
    setResult(null);
    setSubmitError("");
    setRawResponse("");
  }

  async function submitForGrading() {
    setSubmitError("");
    setResult(null);
    setRawResponse("");

    if (!gradingUrl) {
      setSubmitError(
        "Missing NEXT_PUBLIC_BACKEND_URL. Set it in Vercel and redeploy."
      );
      return;
    }
    if (!photos.length) {
      setSubmitError("Capture at least one photo before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        images: photos.map((p) => p.dataUrl),
        meta: {
          source: "web-grading-page",
          capturedCount: photos.length,
          capturedAt: Date.now(),
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        },
      };

      const res = await fetch(gradingUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      setRawResponse(text);

      const data = safeJsonParse(text);

      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} from grading endpoint: ${data?.error || text || "(empty response)"}`
        );
      }

      if (!data) {
        throw new Error("Grading endpoint returned non-JSON response.");
      }

      setResult(data);
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitError(err?.message || "Network error submitting for grading.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleCamera() {
    const next = !usingFrontCamera;
    setUsingFrontCamera(next);
    await startCamera({ front: next });
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Grading</h1>
        <div style={styles.sub}>
          Capture photos, then submit for an assessment.
        </div>
      </div>

      <div style={styles.grid}>
        {/* CAMERA CARD */}
        <div style={styles.card}>
          <div style={styles.cardTitleRow}>
            <div style={styles.cardTitle}>Camera</div>
            <button
              onClick={toggleCamera}
              style={styles.secondaryBtn}
              disabled={submitting}
              title="Switch camera"
            >
              Switch
            </button>
          </div>

          <div style={styles.cameraWrap}>
            <video
              ref={videoRef}
              style={styles.video}
              muted
              playsInline
              autoPlay
            />
            {flash && <div style={styles.flash} />}
            {!cameraReady && (
              <div style={styles.cameraOverlay}>
                {cameraError ? (
                  <>
                    <div style={styles.overlayTitle}>Camera Error</div>
                    <div style={styles.overlayText}>{cameraError}</div>
                    <button
                      onClick={() => startCamera({ front: usingFrontCamera })}
                      style={styles.primaryBtn}
                    >
                      Retry Camera
                    </button>
                  </>
                ) : (
                  <>
                    <div style={styles.overlayTitle}>Starting camera…</div>
                    <div style={styles.overlayText}>Allow camera permissions.</div>
                  </>
                )}
              </div>
            )}
          </div>

          <canvas ref={canvasRef} style={{ display: "none" }} />

          <div style={styles.btnRow}>
            <button
              onClick={capturePhoto}
              style={styles.primaryBtn}
              disabled={!cameraReady || submitting || busyCapture}
            >
              {busyCapture ? "Capturing…" : "Capture Photo"}
            </button>
            <button
              onClick={clearAll}
              style={styles.secondaryBtn}
              disabled={submitting || busyCapture || (!photos.length && !result && !rawResponse)}
            >
              Clear
            </button>
          </div>

          <div style={styles.photoMeta}>
            <div><b>Photos:</b> {photos.length}</div>
            <div style={{ opacity: 0.8 }}>
              Tip: Keep pages flat, fill the frame, avoid glare.
            </div>
          </div>

          {photos.length > 0 && (
            <div style={styles.thumbGrid}>
              {photos.map((p, idx) => (
                <div key={p.id} style={styles.thumb}>
                  <img
                    src={p.dataUrl}
                    alt={`Captured ${idx + 1}`}
                    style={styles.thumbImg}
                  />
                  <div style={styles.thumbBar}>
                    <div style={styles.thumbLabel}>#{idx + 1}</div>
                    <button
                      onClick={() => removePhoto(p.id)}
                      style={styles.thumbRemove}
                      disabled={submitting}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SUBMIT + RESPONSE CARD */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Submit</div>

          <div style={styles.note}>
            <div><b>Endpoint:</b> {gradingUrl || "(not set)"}</div>
            {!backendBase && (
              <div style={styles.warn}>
                Missing <code>NEXT_PUBLIC_BACKEND_URL</code> — set it in Vercel and redeploy.
              </div>
            )}
          </div>

          <div style={styles.btnRow}>
            <button
              onClick={submitForGrading}
              style={styles.primaryBtn}
              disabled={submitting || !photos.length || !gradingUrl}
            >
              {submitting ? "Submitting…" : "Submit for Grading"}
            </button>
          </div>

          {submitError && (
            <div style={styles.errorBox}>
              <b>Error:</b> {submitError}
              <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
                If this persists, check Network tab for status code and confirm the backend route is <code>POST /grading</code>.
              </div>
            </div>
          )}

          <div style={styles.responseTitleRow}>
            <div style={styles.cardTitle}>Response</div>
            {result && (
              <button
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(result, null, 2))}
                style={styles.secondaryBtn}
              >
                Copy JSON
              </button>
            )}
          </div>

          <div style={styles.responseBox}>
            {result ? (
              <pre style={styles.pre}>{JSON.stringify(result, null, 2)}</pre>
            ) : rawResponse ? (
              <pre style={styles.pre}>{rawResponse}</pre>
            ) : (
              <div style={{ opacity: 0.75 }}>
                Results will appear here after submission.
              </div>
            )}
          </div>

          <div style={styles.footerHint}>
            If you see HTTP 404/405: confirm backend route + CORS + correct URL.
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: "24px 18px 40px",
    maxWidth: 1200,
    margin: "0 auto",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#0b1220",
  },
  header: { marginBottom: 16 },
  h1: { margin: 0, fontSize: 28, letterSpacing: -0.3 },
  sub: { marginTop: 6, opacity: 0.78 },

  grid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 14,
  },

  card: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 8px 20px rgba(2, 6, 23, 0.06)",
    background: "white",
  },

  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  responseTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 14,
    marginBottom: 8,
  },
  cardTitle: { fontWeight: 700 },

  cameraWrap: {
    position: "relative",
    borderRadius: 14,
    overflow: "hidden",
    background: "#0b1220",
    aspectRatio: "16 / 9",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  cameraOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 10,
    color: "white",
    background: "linear-gradient(180deg, rgba(2,6,23,0.2), rgba(2,6,23,0.85))",
    textAlign: "center",
  },
  overlayTitle: { fontWeight: 800, fontSize: 18 },
  overlayText: { opacity: 0.9, maxWidth: 420 },

  flash: {
    position: "absolute",
    inset: 0,
    background: "#fff",
    opacity: 0.9,
    pointerEvents: "none",
    animation: "flashAnim 120ms ease-out forwards",
  },

  btnRow: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },

  primaryBtn: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: "rgba(15,23,42,0.06)",
    color: "#0b1220",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },

  photoMeta: {
    marginTop: 12,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    fontSize: 13,
  },

  thumbGrid: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 10,
  },
  thumb: {
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
  },
  thumbImg: { width: "100%", height: 140, objectFit: "cover", display: "block" },
  thumbBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    fontSize: 12,
    background: "rgba(15,23,42,0.03)",
  },
  thumbLabel: { opacity: 0.85, fontWeight: 700 },
  thumbRemove: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    opacity: 0.75,
  },

  note: {
    fontSize: 13,
    opacity: 0.9,
    padding: 10,
    borderRadius: 12,
    background: "rgba(15,23,42,0.03)",
    border: "1px solid rgba(15,23,42,0.10)",
  },
  warn: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.30)",
    color: "#7c2d12",
  },

  errorBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(239,68,68,0.10)",
    border: "1px solid rgba(239,68,68,0.25)",
    color: "#7f1d1d",
    fontSize: 13,
  },

  responseBox: {
    marginTop: 0,
    minHeight: 220,
    borderRadius: 12,
    padding: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.02)",
    overflow: "auto",
  },
  pre: { margin: 0, fontSize: 12, lineHeight: 1.4, whiteSpace: "pre-wrap" },

  footerHint: { marginTop: 10, fontSize: 12, opacity: 0.75 },
};

// Keyframes injected once (no external css file required)
if (typeof document !== "undefined") {
  const id = "grading-page-flash-keyframes";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes flashAnim { from { opacity: 0.9; } to { opacity: 0; } }
      button:disabled { opacity: 0.55; cursor: not-allowed; }
      @media (min-width: 980px) {
        /* make the two cards sit side-by-side on desktop */
        body .__gradingGridFix {}
      }
    `;
    document.head.appendChild(style);
  }
}