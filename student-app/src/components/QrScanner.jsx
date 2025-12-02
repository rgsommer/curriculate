// student-app/src/components/QrScanner.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * Props:
 *   - active: boolean  → whether scanner should run
 *   - onCode: (value: string) => boolean | void
 *        • If it returns true, we stop scanning
 *        • If it returns false, we keep scanning
 *   - onError: (msg: string) => void
 */
export default function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [supportsCamera, setSupportsCamera] = useState(false);
  const [manualValue, setManualValue] = useState("");

  useEffect(() => {
    let stream = null;
    let animationId = null;
    let detector = null;
    let stopped = false;
    let startTimeout = null;

    async function start() {
      if (stopped) return;
      if (!active) return;

      // Guard against running on the server or too early
      if (typeof navigator === "undefined" || typeof window === "undefined") {
        console.warn("[QrScanner] navigator/window not available");
        setSupportsCamera(false);
        return;
      }

      // Make sure the DOM has mounted the <video> before we touch it
      if (!videoRef.current) {
        console.warn("[QrScanner] videoRef not ready, delaying start...");
        startTimeout = setTimeout(start, 80);
        return;
      }

      // Check camera availability
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        console.warn("[QrScanner] getUserMedia not available");
        setSupportsCamera(false);
        onError &&
          onError(
            "This device does not support camera scanning. Please type the code."
          );
        return;
      }

      // Feature detect BarcodeDetector
      if (!("BarcodeDetector" in window)) {
        console.warn("[QrScanner] BarcodeDetector not available, manual mode only");
        setSupportsCamera(false);
        onError &&
          onError(
            "Live QR scanning is not supported on this browser. Please type the code from the station label."
          );
        return;
      }

      try {
        // eslint-disable-next-line no-undef
        detector = new BarcodeDetector({ formats: ["qr_code"] });
      } catch (err) {
        console.warn("[QrScanner] Failed to construct BarcodeDetector:", err);
        setSupportsCamera(false);
        onError &&
          onError(
            "Live QR scanning is not available. Please type the code from the station label."
          );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch (err) {
        console.error("[QrScanner] getUserMedia error:", err);
        setSupportsCamera(false);
        onError &&
          onError(
            "We couldn't access the camera. Check permissions and try again, or type the code."
          );
        return;
      }

      if (!videoRef.current) {
        console.warn("[QrScanner] videoRef missing after getUserMedia");
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        setSupportsCamera(false);
        return;
      }

      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsInline", "true");

      // Wait for video metadata so we have proper dimensions
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
        if (!active) {
          animationId = requestAnimationFrame(loop);
          return;
        }
        if (!videoRef.current || !canvasRef.current || !detector) {
          animationId = requestAnimationFrame(loop);
          return;
        }

        const v = videoRef.current;
        const c = canvasRef.current;
        const ctx = c.getContext("2d");

        const vw = v.videoWidth || 0;
        const vh = v.videoHeight || 0;
        if (vw === 0 || vh === 0) {
          // Video not ready yet; try again on next frame
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
          console.warn("[QrScanner] detect error:", err);
          onError &&
            onError(
              "There was a problem reading that code. Try holding it steady and closer."
            );
        }

        animationId = requestAnimationFrame(loop);
      };

      animationId = requestAnimationFrame(loop);
    }

    function stop() {
      stopped = true;
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
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
      // Slight delay to ensure React has painted the DOM
      startTimeout = setTimeout(start, 0);
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
              height: 260,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              objectFit: "cover",
              background: "#000",
            }}
            muted
            playsInline
          />
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
            Camera scanning is not available on this device. Type the code from
            the station&apos;s QR label instead.
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
