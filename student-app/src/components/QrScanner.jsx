// student-app/src/components/QrScanner.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * Props:
 *   - active: boolean  → whether scanner should run
 *   - onCode: (value: string) => boolean | void
 *        • Return true if scan was accepted (we'll stop scanning)
 *        • Return false to keep scanning
 *   - onError: (msg: string) => void
 */
export default function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [supportsCamera, setSupportsCamera] = useState(false);
  const [manualValue, setManualValue] = useState("");

  // Camera + BarcodeDetector loop
  useEffect(() => {
    let stream = null;
    let animationId = null;
    let detector = null;

    async function start() {
      try {
        if (!active) return;

        if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
          setSupportsCamera(false);
          return;
        }

        // BarcodeDetector is not everywhere – feature detect
        if ("BarcodeDetector" in window) {
          // eslint-disable-next-line no-undef
          detector = new BarcodeDetector({ formats: ["qr_code"] });
        } else {
          // No detector → fall back to manual mode
          setSupportsCamera(false);
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        setSupportsCamera(true);

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const loop = async () => {
          if (!active || !videoRef.current || !canvasRef.current || !detector) {
            return;
          }

          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");

          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          try {
            const barcodes = await detector.detect(canvas);
            if (barcodes && barcodes.length > 0) {
              const rawValue = barcodes[0].rawValue || "";
              if (rawValue) {
                const accepted = onCode ? onCode(rawValue) : true;
                if (accepted !== false) {
                  // Stop scanning if the parent accepted the code
                  stop();
                  return;
                }
              }
            }
          } catch (err) {
            console.warn("QR detect error:", err);
            onError && onError("There was a problem reading the code.");
          }

          animationId = requestAnimationFrame(loop);
        };

        animationId = requestAnimationFrame(loop);
      } catch (err) {
        console.error("QR scanner start error:", err);
        setSupportsCamera(false);
        onError && onError("Camera not available. Type the code instead.");
      }
    }

    function stop() {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }

    if (active) {
      start();
    }

    return () => {
      stop();
    };
  }, [active, onCode, onError]);

  // If not active, render nothing at all
  if (!active) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {supportsCamera ? (
        <>
          <video
            ref={videoRef}
            style={{
              width: "100%",
              maxHeight: 260,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              objectFit: "cover",
              background: "#000",
            }}
            muted
            playsInline
          />
          {/* Hidden canvas used for frame analysis */}
          <canvas
            ref={canvasRef}
            style={{ display: "none" }}
          />
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "#4b5563",
            }}
          >
            Hold the QR code steady in front of the camera. It will snap
            automatically when it can read it.
          </p>
        </>
      ) : (
        <>
          <p
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "#b91c1c",
            }}
          >
            Camera scanning not available on this device. Type the code from
            the station QR label instead.
          </p>
          <input
            type="text"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="e.g. https://play.curriculate.net/Classroom/red"
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              fontSize: "0.95rem",
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!manualValue.trim()) return;
              const accepted = onCode ? onCode(manualValue.trim()) : true;
              if (accepted !== false) {
                setManualValue("");
              }
            }}
            style={{
              marginTop: 4,
              alignSelf: "flex-start",
              padding: "6px 10px",
              borderRadius: 999,
              border: "none",
              background: "#3b82f6",
              color: "#ffffff",
              fontSize: "0.9rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Use this code
          </button>
        </>
      )}
    </div>
  );
}
