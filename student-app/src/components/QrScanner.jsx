// student-app/src/components/QrScanner.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * Props:
 *   - active: boolean – when true, starts the camera and scanning
 *   - onCode: (decodedText: string) => boolean | void
 *       Called when a QR code is detected. If it returns `true`,
 *       the scanner will stop; otherwise it will keep scanning.
 *   - onError: (message: string) => void
 *       Called if there is a camera / permission / decode error.
 */
function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [supportsBarcodeDetector, setSupportsBarcodeDetector] = useState(
    typeof window !== "undefined" && "BarcodeDetector" in window
  );

  useEffect(() => {
    let stream = null;
    let animationId = null;
    let detector = null;

    async function startCamera() {
      if (!active) return;

      try {
        // Request rear camera if available
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (!("BarcodeDetector" in window)) {
          setSupportsBarcodeDetector(false);
          return;
        }

        detector = new window.BarcodeDetector({ formats: ["qr_code"] });

        const scanFrame = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            animationId = requestAnimationFrame(scanFrame);
            return;
          }

          try {
            const bitmaps = [videoRef.current];
            const barcodes = await detector.detect(...bitmaps);
            if (barcodes && barcodes.length > 0) {
              const rawValue = barcodes[0].rawValue || "";
              if (rawValue) {
                const shouldStop = onCode ? onCode(rawValue) === true : true;
                if (shouldStop) {
                  // Stop scanning (but keep video until unmounted or inactive)
                  cancelAnimationFrame(animationId);
                  animationId = null;
                  return;
                }
              }
            }
          } catch (err) {
            console.warn("QR detect error:", err);
            if (onError) {
              onError("There was a problem reading that code. Try again.");
            }
          }

          animationId = requestAnimationFrame(scanFrame);
        };

        animationId = requestAnimationFrame(scanFrame);
      } catch (err) {
        console.error("Camera error:", err);
        const msg =
          err?.name === "NotAllowedError"
            ? "Camera access was denied. Please allow camera access and try again."
            : "We could not start the camera. Please tell your teacher.";
        setCameraError(msg);
        if (onError) onError(msg);
      }
    }

    if (active && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      startCamera();
    } else if (active) {
      const msg =
        "This device does not support camera access in the browser. Please tell your teacher.";
      setCameraError(msg);
      if (onError) onError(msg);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [active, onCode, onError]);

  const handleManualScan = () => {
    const value = window.prompt(
      "Manual code entry (for testing). Paste or type the QR text:"
    );
    if (value && onCode) {
      onCode(value);
    }
  };

  return (
    <div
      ref={frameRef}
      style={{
        width: "100%",
        maxWidth: 400,
        margin: "0 auto",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #e5e7eb",
        background: "#000",
        position: "relative",
      }}
    >
      <video
        ref={videoRef}
        style={{
          width: "100%",
          height: "auto",
          display: cameraError ? "none" : "block",
        }}
        playsInline
        muted
      />

      {!supportsBarcodeDetector && !cameraError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.75))",
            color: "#f9fafb",
            fontSize: "0.9rem",
            textAlign: "center",
          }}
        >
          <div>
            <p style={{ marginTop: 0 }}>
              This browser doesn&apos;t support live QR scanning yet.
            </p>
            <p style={{ marginBottom: 8 }}>
              You can still test by manually entering the code.
            </p>
            <button
              type="button"
              onClick={handleManualScan}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "none",
                background: "#0ea5e9",
                color: "#ffffff",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Enter code manually
            </button>
          </div>
        </div>
      )}

      {cameraError && (
        <div
          style={{
            padding: 12,
            fontSize: "0.85rem",
            color: "#b91c1c",
            background: "#fef2f2",
          }}
        >
          {cameraError}
        </div>
      )}
    </div>
  );
}

export default QrScanner;
