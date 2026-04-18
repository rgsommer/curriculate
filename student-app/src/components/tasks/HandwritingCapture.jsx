// student-app/src/components/tasks/HandwritingCapture.jsx
import React, { useState, useRef, useCallback } from "react";
import { API_BASE_URL } from "../../config.js";

/**
 * HandwritingCapture — "Write on paper" bonus component.
 *
 * Embeds inside any text-based task. Student writes on paper, snaps a photo,
 * the backend OCRs it via GPT-4o vision, and the extracted text fills the
 * answer field. Submission is flagged for bonus points.
 *
 * Single-player mode (default):
 *   One photo → one OCR → fills the answer field.
 *
 * Multi-player mode (when memberNames is provided):
 *   Each team member writes their own response and snaps their own photo.
 *   All texts are combined, and all photos are attached. The bonus is
 *   multiplied by the number of players who participate.
 *
 * Props:
 *   onTextExtracted(text, photoDataUrl, allPlayerPhotos?) — called when OCR succeeds
 *   disabled — disable all controls
 *   bonusPoints — points awarded per player for handwriting (shown to student)
 *   roomCode, teamId — for context (optional)
 *   memberNames — array of player names for multi-player mode (optional)
 */

const HANDWRITING_BONUS_POINTS = 10;

export default function HandwritingCapture({
  onTextExtracted,
  disabled = false,
  bonusPoints = HANDWRITING_BONUS_POINTS,
  roomCode,
  teamId,
  memberNames = [],
}) {
  const isMultiPlayer = Array.isArray(memberNames) && memberNames.length > 1;

  // ── Single-player state ──
  const [mode, setMode] = useState("idle"); // "idle" | "camera" | "preview" | "processing" | "done" | "error" | "multi"
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [extractedText, setExtractedText] = useState("");
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Multi-player state ──
  // Each entry: { name, photoDataUrl, text, status: "pending"|"capturing"|"preview"|"processing"|"done" }
  const [playerEntries, setPlayerEntries] = useState([]);
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.playsInline = true;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Could not access camera. Try uploading a photo instead.");
      if (isMultiPlayer && mode === "multi") {
        // stay in multi mode
      } else {
        setMode("idle");
      }
    }
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    stopCamera();
    return dataUrl;
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (isMultiPlayer && mode === "multi") {
        handleMultiPlayerPhoto(reader.result);
      } else {
        setPhotoDataUrl(reader.result);
        setMode("preview");
      }
    };
    reader.readAsDataURL(file);
  }

  async function processOCR(imageData) {
    const image = imageData || photoDataUrl;
    if (!image) return null;

    const res = await fetch(`${API_BASE_URL}/api/ocr/handwriting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        roomCode: roomCode || undefined,
        teamId: teamId || undefined,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `OCR failed (${res.status})`);
    }

    const data = await res.json();
    return data.text || "";
  }

  function reset() {
    stopCamera();
    setPhotoDataUrl(null);
    setExtractedText("");
    setError("");
    setPlayerEntries([]);
    setActivePlayerIdx(0);
    setMode("idle");
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SINGLE-PLAYER FLOW (original behavior)
  // ═══════════════════════════════════════════════════════════════════

  function startSinglePlayer() {
    setMode("camera");
    startCamera();
  }

  function singleCapture() {
    const dataUrl = capturePhoto();
    if (dataUrl) {
      setPhotoDataUrl(dataUrl);
      setMode("preview");
    }
  }

  async function singleProcessOCR() {
    if (!photoDataUrl) return;
    setMode("processing");
    setError("");
    try {
      const text = await processOCR(photoDataUrl);
      if (!text?.trim()) {
        setError("Could not read any text from the photo. Try writing more clearly or retake the photo.");
        setMode("preview");
        return;
      }
      setExtractedText(text);
      setMode("done");
      if (onTextExtracted) onTextExtracted(text, photoDataUrl);
    } catch (err) {
      console.error("OCR error:", err);
      setError(err?.message || "Failed to process handwriting. Please try again.");
      setMode("preview");
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MULTI-PLAYER FLOW — each player writes and snaps
  // ═══════════════════════════════════════════════════════════════════

  function startMultiPlayer() {
    const entries = memberNames.map((name) => ({
      name,
      photoDataUrl: null,
      text: "",
      status: "pending",
    }));
    setPlayerEntries(entries);
    setActivePlayerIdx(0);
    setMode("multi");
  }

  function handleMultiPlayerPhoto(dataUrl) {
    setPlayerEntries((prev) => {
      const updated = [...prev];
      updated[activePlayerIdx] = { ...updated[activePlayerIdx], photoDataUrl: dataUrl, status: "preview" };
      return updated;
    });
  }

  function multiCapture() {
    const dataUrl = capturePhoto();
    if (dataUrl) {
      handleMultiPlayerPhoto(dataUrl);
    }
  }

  async function multiProcessOCR() {
    const entry = playerEntries[activePlayerIdx];
    if (!entry?.photoDataUrl) return;

    setPlayerEntries((prev) => {
      const updated = [...prev];
      updated[activePlayerIdx] = { ...updated[activePlayerIdx], status: "processing" };
      return updated;
    });
    setError("");

    try {
      const text = await processOCR(entry.photoDataUrl);
      if (!text?.trim()) {
        setError(`Could not read ${entry.name}'s writing. Try again or retake.`);
        setPlayerEntries((prev) => {
          const updated = [...prev];
          updated[activePlayerIdx] = { ...updated[activePlayerIdx], status: "preview" };
          return updated;
        });
        return;
      }

      setPlayerEntries((prev) => {
        const updated = [...prev];
        updated[activePlayerIdx] = { ...updated[activePlayerIdx], text, status: "done" };
        return updated;
      });

      // Move to next player or finish
      const nextIdx = activePlayerIdx + 1;
      if (nextIdx < memberNames.length) {
        setActivePlayerIdx(nextIdx);
      } else {
        // All done — combine texts and notify parent
        const allEntries = playerEntries.map((e, i) =>
          i === activePlayerIdx ? { ...e, text, status: "done" } : e
        );
        const combinedText = allEntries
          .filter((e) => e.text)
          .map((e) => `[${e.name}]\n${e.text}`)
          .join("\n\n");
        const allPhotos = allEntries
          .filter((e) => e.photoDataUrl)
          .map((e) => ({ name: e.name, photoUrl: e.photoDataUrl }));

        setMode("done");
        if (onTextExtracted) {
          onTextExtracted(combinedText, allPhotos[0]?.photoUrl || null, allPhotos);
        }
      }
    } catch (err) {
      console.error("OCR error:", err);
      setError(err?.message || "Failed to process handwriting. Please try again.");
      setPlayerEntries((prev) => {
        const updated = [...prev];
        updated[activePlayerIdx] = { ...updated[activePlayerIdx], status: "preview" };
        return updated;
      });
    }
  }

  function multiStartCapture() {
    setPlayerEntries((prev) => {
      const updated = [...prev];
      updated[activePlayerIdx] = { ...updated[activePlayerIdx], status: "capturing" };
      return updated;
    });
    startCamera();
  }

  function multiSkipPlayer() {
    const nextIdx = activePlayerIdx + 1;
    if (nextIdx < memberNames.length) {
      setActivePlayerIdx(nextIdx);
    } else {
      // Finish with whoever participated
      const completedEntries = playerEntries.filter((e) => e.text);
      if (completedEntries.length === 0) {
        reset();
        return;
      }
      const combinedText = completedEntries
        .map((e) => `[${e.name}]\n${e.text}`)
        .join("\n\n");
      const allPhotos = completedEntries
        .filter((e) => e.photoDataUrl)
        .map((e) => ({ name: e.name, photoUrl: e.photoDataUrl }));
      setMode("done");
      if (onTextExtracted) {
        onTextExtracted(combinedText, allPhotos[0]?.photoUrl || null, allPhotos);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════

  // ── IDLE: show the toggle button ──
  if (mode === "idle") {
    const completedCount = playerEntries.filter((e) => e.status === "done").length;
    return (
      <div style={styles.container}>
        <button
          type="button"
          onClick={isMultiPlayer ? startMultiPlayer : startSinglePlayer}
          disabled={disabled}
          style={styles.toggleBtn}
        >
          <span style={{ fontSize: "1.1rem" }}>✍️</span>
          <span>Write on paper</span>
          <span style={styles.bonusBadge}>
            +{isMultiPlayer ? `${bonusPoints}×${memberNames.length}` : bonusPoints} bonus
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />
        {!isMultiPlayer && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            style={styles.uploadLink}
          >
            or upload a photo
          </button>
        )}
        {isMultiPlayer && (
          <div style={{ fontSize: "0.78rem", color: "#94a3b8", fontWeight: 600, textAlign: "center" }}>
            Each player writes their own response
          </div>
        )}
        {error && <div style={styles.errorText}>{error}</div>}
      </div>
    );
  }

  // ── MULTI-PLAYER MODE ──
  if (mode === "multi") {
    const entry = playerEntries[activePlayerIdx];
    const completedCount = playerEntries.filter((e) => e.status === "done").length;
    const playerName = entry?.name || `Player ${activePlayerIdx + 1}`;

    return (
      <div style={styles.container}>
        {/* Progress bar */}
        <div style={{
          display: "flex", gap: 4, width: "100%", maxWidth: 400, marginBottom: 4,
        }}>
          {memberNames.map((name, i) => (
            <div key={name} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: playerEntries[i]?.status === "done"
                ? "#22c55e"
                : i === activePlayerIdx
                ? "#8b5cf6"
                : "rgba(100,116,139,0.2)",
              transition: "background 0.3s",
            }} />
          ))}
        </div>

        <div style={{
          fontSize: "0.9rem", fontWeight: 800, color: "#c4b5fd",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>✍️</span>
          <span>{playerName}'s turn</span>
          <span style={{ color: "#64748b", fontWeight: 600 }}>
            ({activePlayerIdx + 1}/{memberNames.length})
          </span>
        </div>

        {/* Player hasn't started capturing yet */}
        {entry?.status === "pending" && (
          <>
            <div style={styles.cameraHelp}>
              {playerName}, write your response on paper, then take a photo
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={multiStartCapture} style={styles.captureBtn}>
                📷 Take photo
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={styles.cancelBtn}>
                📁 Upload
              </button>
              <button onClick={multiSkipPlayer} style={styles.cancelBtn}>
                Skip
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
          </>
        )}

        {/* Camera is active */}
        {entry?.status === "capturing" && (
          <>
            <div style={styles.cameraHelp}>
              Point at {playerName}'s written work
            </div>
            <div style={styles.videoWrapper}>
              <video ref={videoRef} style={styles.video} playsInline muted />
            </div>
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={multiCapture} style={styles.captureBtn}>
                📷 Capture
              </button>
              <button onClick={() => {
                stopCamera();
                setPlayerEntries((prev) => {
                  const updated = [...prev];
                  updated[activePlayerIdx] = { ...updated[activePlayerIdx], status: "pending" };
                  return updated;
                });
              }} style={styles.cancelBtn}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Preview photo */}
        {entry?.status === "preview" && (
          <>
            <div style={styles.cameraHelp}>
              {playerName}'s photo — is it clear?
            </div>
            {entry.photoDataUrl && (
              <img src={entry.photoDataUrl} alt={`${playerName}'s handwriting`} style={styles.previewImg} />
            )}
            {error && <div style={styles.errorText}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={multiProcessOCR} style={styles.captureBtn}>
                ✅ Read {playerName}'s writing
              </button>
              <button onClick={() => {
                setPlayerEntries((prev) => {
                  const updated = [...prev];
                  updated[activePlayerIdx] = { ...updated[activePlayerIdx], photoDataUrl: null, status: "pending" };
                  return updated;
                });
              }} style={styles.cancelBtn}>
                🔄 Retake
              </button>
            </div>
          </>
        )}

        {/* Processing */}
        {entry?.status === "processing" && (
          <>
            <div style={{ fontSize: "2rem" }}>🔍</div>
            <div style={styles.processingText}>Reading {playerName}'s handwriting...</div>
            <div style={styles.processingSubtext}>This takes a few seconds</div>
          </>
        )}

        {/* This player is done, moving to next */}
        {entry?.status === "done" && activePlayerIdx < memberNames.length - 1 && (
          <>
            <div style={styles.doneBox}>
              <div style={{ fontSize: "1rem" }}>✅ {playerName}'s writing captured!</div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── CAMERA (single-player): live viewfinder ──
  if (mode === "camera") {
    return (
      <div style={styles.container}>
        <div style={styles.cameraHelp}>
          Point your camera at your written work and tap capture
        </div>
        <div style={styles.videoWrapper}>
          <video ref={videoRef} style={styles.video} playsInline muted />
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={singleCapture} style={styles.captureBtn}>
            📷 Capture
          </button>
          <button onClick={() => { stopCamera(); setMode("idle"); }} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── PREVIEW (single-player): show photo, confirm for OCR ──
  if (mode === "preview") {
    return (
      <div style={styles.container}>
        <div style={styles.cameraHelp}>
          Does the photo look clear and readable?
        </div>
        {photoDataUrl && (
          <img src={photoDataUrl} alt="Your handwriting" style={styles.previewImg} />
        )}
        {error && <div style={styles.errorText}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={singleProcessOCR} style={styles.captureBtn}>
            ✅ Read my writing
          </button>
          <button onClick={() => { setPhotoDataUrl(null); startSinglePlayer(); }} style={styles.cancelBtn}>
            🔄 Retake
          </button>
          <button onClick={reset} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── PROCESSING (single-player): spinner ──
  if (mode === "processing") {
    return (
      <div style={styles.container}>
        <div style={{ fontSize: "2rem" }}>🔍</div>
        <div style={styles.processingText}>Reading your handwriting...</div>
        <div style={styles.processingSubtext}>This takes a few seconds</div>
      </div>
    );
  }

  // ── DONE: show confirmation ──
  if (mode === "done") {
    const completedCount = isMultiPlayer
      ? playerEntries.filter((e) => e.status === "done").length
      : 1;
    const totalBonus = completedCount * bonusPoints;

    return (
      <div style={styles.container}>
        <div style={styles.doneBox}>
          <div style={{ fontSize: "1.3rem" }}>✍️ ✅</div>
          <div style={styles.doneTitle}>Handwriting captured!</div>
          {isMultiPlayer && (
            <div style={{ fontSize: "0.8rem", color: "#86efac", fontWeight: 700, marginTop: 2 }}>
              {completedCount}/{memberNames.length} players wrote on paper
            </div>
          )}
          {isMultiPlayer && completedCount > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginTop: 6 }}>
              {playerEntries.filter((e) => e.status === "done").map((e) => (
                <span key={e.name} style={{
                  padding: "2px 8px", borderRadius: 8, background: "rgba(34,197,94,0.15)",
                  color: "#86efac", fontSize: "0.72rem", fontWeight: 700,
                }}>
                  ✅ {e.name}
                </span>
              ))}
            </div>
          )}
          <div style={styles.doneSubtext}>
            Your text has been filled in below. You'll earn <strong>+{totalBonus} bonus points</strong> for writing on paper.
          </div>
        </div>
        <button onClick={reset} style={styles.uploadLink}>
          Start over
        </button>
      </div>
    );
  }

  return null;
}

export { HANDWRITING_BONUS_POINTS };

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
  },
  toggleBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    borderRadius: 12,
    border: "1px dashed rgba(139,92,246,0.4)",
    background: "rgba(139,92,246,0.08)",
    color: "#c4b5fd",
    fontSize: "0.9rem",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  bonusBadge: {
    padding: "2px 8px",
    borderRadius: 99,
    background: "rgba(34,197,94,0.2)",
    color: "#86efac",
    fontSize: "0.75rem",
    fontWeight: 800,
  },
  uploadLink: {
    background: "none",
    border: "none",
    color: "#94a3b8",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
    padding: "4px 8px",
  },
  cameraHelp: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    fontWeight: 600,
    textAlign: "center",
    maxWidth: 280,
  },
  videoWrapper: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 14,
    overflow: "hidden",
    border: "2px solid rgba(139,92,246,0.3)",
  },
  video: {
    width: "100%",
    height: "auto",
    display: "block",
    transform: "scaleX(1)", // don't mirror rear camera
  },
  previewImg: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 14,
    border: "2px solid rgba(139,92,246,0.3)",
  },
  captureBtn: {
    padding: "10px 20px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
    color: "#fff",
    fontSize: "0.95rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(139,92,246,0.3)",
  },
  cancelBtn: {
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid rgba(100,116,139,0.3)",
    background: "rgba(100,116,139,0.1)",
    color: "#94a3b8",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  processingText: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "#c4b5fd",
  },
  processingSubtext: {
    fontSize: "0.8rem",
    color: "#94a3b8",
  },
  errorText: {
    fontSize: "0.85rem",
    color: "#fca5a5",
    fontWeight: 600,
    textAlign: "center",
    maxWidth: 300,
    padding: "6px 12px",
    background: "rgba(239,68,68,0.1)",
    borderRadius: 10,
  },
  doneBox: {
    padding: "14px 20px",
    borderRadius: 14,
    background: "rgba(34,197,94,0.1)",
    border: "1px solid rgba(34,197,94,0.25)",
    textAlign: "center",
    maxWidth: 320,
  },
  doneTitle: {
    fontSize: "1rem",
    fontWeight: 800,
    color: "#86efac",
    marginTop: 4,
  },
  doneSubtext: {
    fontSize: "0.8rem",
    color: "#94a3b8",
    marginTop: 6,
    lineHeight: 1.4,
  },
};
