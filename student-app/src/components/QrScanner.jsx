// student-app/src/components/QrScanner.jsx
import React, { useEffect, useRef, useState } from "react";

export default function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const animationRef = useRef(null);
  const streamRef = useRef(null);
  const [scanning, setScanning] = useState(false);

  // ────── START CAMERA ──────
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, // rear camera
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setScanning(true);
      } catch (err) {
        console.error("Camera error:", err);
        onError?.(err.message || "Camera access denied");
      }
    };

    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setScanning(false);
    };
  }, [active, onError]);

  // ────── SCAN LOOP (BarcodeDetector API) ──────
  useEffect(() => {
    if (!active || !scanning || !("BarcodeDetector" in window)) return;

    const detector = new BarcodeDetector({ formats: ["qr_code"] });

    const scan = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animationRef.current = requestAnimationFrame(scan);
        return;
      }

      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0) {
          const result = barcodes[0].rawValue;
          const stop = onCode?.(result) !== false;
          if (stop) return; // parent will set active=false
        }
      } catch (err) {
        // ignore — just keep scanning
      }

      animationRef.current = requestAnimationFrame(scan);
    };

    animationRef.current = requestAnimationFrame(scan);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [active, scanning, onCode]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 500,
        margin: "0 auto",
        borderRadius: 16,
        overflow: "hidden",
        background: "#000",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: "100%",
          height: "auto",
          display: "block",
        }}
      />

      {/* Overlay when camera is loading */}
      {!scanning && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.2rem",
          }}
        >
          <div className="animate-spin mb-4">↻</div>
          <p>Starting camera…</p>
        </div>
      )}
    </div>
  );
}