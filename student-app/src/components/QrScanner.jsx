import React, { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";

/**
 * Props (backwards compatible):
 *   - active?: boolean  → whether scanner should run (defaults to true)
 *   - onCode?: (value: string) => boolean | void
 *   - onScan?: (value: string) => boolean | void   // legacy alias used by StudentApp
 *        • If handler returns true, we stop scanning
 *        • If handler returns false, we keep scanning
 *   - onError?: (msg: string) => void
 *
 * IMPORTANT: The camera stream stays alive across active/inactive cycles to
 * avoid the black flash / cycling on slower tablets. The stream is only stopped
 * when the component fully unmounts.
 */
export default function QrScanner({ active = true, onCode, onScan, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Keep latest handler without re-starting camera
  const handlerRef = useRef(null);
  useEffect(() => {
    handlerRef.current = onCode || onScan || null;
  }, [onCode, onScan]);

  const [cameraError, setCameraError] = useState(null);
  const [manualValue, setManualValue] = useState("");

  // Persistent refs for stream and scan-loop control
  const streamRef = useRef(null);
  const scanningRef = useRef(false);
  const rafIdRef = useRef(null);
  const timeoutIdRef = useRef(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;

  // Start the camera stream (only once, reused across active cycles)
  useEffect(() => {
    mountedRef.current = true;

    async function initCamera() {
      if (typeof window === "undefined" || typeof navigator === "undefined") return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          "This device does not support camera access in the browser. Please type the code instead."
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }

        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsInline", "true");

        // Wait for metadata so videoWidth/Height exist
        await new Promise((resolve) => {
          if (video.readyState >= 1) return resolve();
          const handleLoaded = () => {
            video.removeEventListener("loadedmetadata", handleLoaded);
            resolve();
          };
          video.addEventListener("loadedmetadata", handleLoaded);
        });

        try {
          const p = video.play();
          if (p && typeof p.then === "function") await p;
        } catch (err) {
          console.warn("[QrScanner] video.play() failed:", err);
        }

        // If active at init time, start scanning immediately
        if (activeRef.current && mountedRef.current) {
          startScanning();
        }
      } catch (err) {
        console.error("[QrScanner] getUserMedia error:", err);
        if (!mountedRef.current) return;
        setCameraError(
          "We couldn't access the camera. Check permissions and try again, or type the code instead."
        );
      }
    }

    initCamera();

    // Cleanup: stop stream only on full unmount
    return () => {
      mountedRef.current = false;
      stopScanning();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []); // ← only runs once on mount

  // Start/stop the scanning loop when `active` changes
  function startScanning() {
    if (scanningRef.current) return;
    scanningRef.current = true;

    const loop = () => {
      if (!scanningRef.current || !mountedRef.current) return;

      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c) {
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      const ctx = c.getContext("2d", { willReadFrequently: true });
      const vw = v.videoWidth || 0;
      const vh = v.videoHeight || 0;

      if (!vw || !vh) {
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      c.width = vw;
      c.height = vh;
      ctx.drawImage(v, 0, 0, c.width, c.height);

      try {
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const qr = jsQR(imageData.data, c.width, c.height);

        if (qr && qr.data) {
          const rawValue = qr.data;

          let accepted = true;
          const handler = handlerRef.current;
          if (handler) accepted = handler(rawValue);

          // Only pause scanning if handler didn't explicitly return false
          if (accepted !== false) {
            stopScanning();
            return;
          }
        }
      } catch (err) {
        console.warn("[QrScanner] jsQR detect error:", err);
        onError?.("There was a problem reading that code. Try holding it steady and closer.");
      }

      // ~15fps — fast enough for fluid scanning, light enough for tablets
      timeoutIdRef.current = window.setTimeout(() => {
        rafIdRef.current = requestAnimationFrame(loop);
      }, 66);
    };

    rafIdRef.current = requestAnimationFrame(loop);
  }

  function stopScanning() {
    scanningRef.current = false;
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // NOTE: we do NOT stop the stream here — camera stays warm
  }

  // React to `active` prop changes: start/stop scanning loop
  useEffect(() => {
    if (active && streamRef.current) {
      startScanning();
    } else {
      stopScanning();
    }
  }, [active]);

  const handler = onCode || onScan;
  const showManualOnly = !!cameraError;

  const handleManualSubmit = () => {
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    if (handler) {
      const accepted = handler(trimmed);
      if (accepted !== false) setManualValue("");
    } else {
      setManualValue("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!showManualOnly && (
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
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#4b5563" }}>
            Hold the QR code steady in front of the camera. It will snap automatically when it can read it.
          </p>
        </>
      )}

      {showManualOnly && (
        <>
          {cameraError && (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
              {cameraError}
            </p>
          )}
          <input
            type="text"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="e.g. RED-01"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              fontSize: "0.9rem",
            }}
          />
          <button
            type="button"
            onClick={handleManualSubmit}
            style={{
              padding: "8px 10px",
              borderRadius: 999,
              border: "none",
              background: "#0f766e",
              color: "#ecfdf5",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Submit code
          </button>
        </>
      )}
    </div>
  );
}
