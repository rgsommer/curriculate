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
    let stopped = false;

    async function start() {
      try {
        if (!active) return;

        if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
          console.warn("[QrScanner] mediaDevices or getUserMedia not available");
          setSupportsCamera(false);
          return;
        }

        // BarcodeDetector is not everywhere – feature detect
        if ("BarcodeDetector" in window) {
          // eslint-disable-next-line no-undef
          detector = new BarcodeDetector({ formats: ["qr_code"] });
        } else {
          console.warn("[QrScanner] BarcodeDetector not available, using manual mode");
          setSupportsCamera(false);
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (!videoRef.current) {
          console.warn("[QrScanner] videoRef missing after getUserMedia");
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          return;
        }

        const video = videoRef.current;
        video.srcObject = stream;
        // Make sure mobile browsers are happy
        video.muted = true;
        video.setAttribute("playsInline", "true");

        // Wait for metadata so width/height are available
        await new Promise((resolve) => {
          const handleLoaded = () => {
            video.removeEventListener("loadedmetadata", handleLoaded);
            resolve();
          };
          if (video.readyState >= 1) {
            resolve();
          } else {
            video.addEventListener("loadedmetadata", handleLoaded);
          }
        });

        try {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.then === "function") {
            await playPromise;
          }
        } catch (err) {
          console.warn("[QrScanner] video.play() failed:", err);
        }

        console.log(
          "[QrScanner] video started",
          "videoWidth=",
          video.videoWidth,
          "videoHeight=",
          video.videoHeight
        );

        setSupportsCamera(true);

        const loop = async () => {
          if (stopped) return;
          if (!active || !videoRef.current || !canvasRef.current || !detector) {
            animationId = requestAnimationFrame(loop);
            return;
          }

          const v = videoRef.current;
          const c = canvasRef.current;
          const ctx = c.getContext("2d");

          // Sometimes videoWidth/videoHeight start at 0 – skip detection until ready
          const vw = v.videoWidth || 0;
          const vh = v.videoHeight || 0;
          if (vw === 0 || vh === 0) {
            animationId = requestAnimationFrame(loop);
            return;
          }

          c.width = vw;
          c.height = vh;
          ctx.drawImage(v, 0, 0, c.width, c.height);

          try {
            const barcodes = await detector.detect(c);
            if (barcodes && barcodes.length > 0) {
              const rawValue = barcodes[0].rawValue || "";
              if (rawValue) {
                console.log("[QrScanner] detected QR:", rawValue);
                const accepted = onCode ? onCode(rawValue) : true;
                if (accepted !== false) {
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
      stopped = true;
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
              height: 260, // fixed height to avoid weird zero-height cases
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
