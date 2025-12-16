import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Props (backwards compatible):
 *   - active?: boolean  → whether scanner should run (defaults to true)
 *   - onCode?: (value: string) => boolean | void
 *   - onScan?: (value: string) => boolean | void   // legacy alias used by StudentApp
 *        • If handler returns true, we stop scanning
 *        • If handler returns false, we keep scanning
 *   - onError?: (msg: string) => void
 */
export default function QrScanner({ active = true, onCode, onScan, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // ✅ Keep latest handler without re-starting camera
  const handlerRef = useRef(null);
  useEffect(() => {
    handlerRef.current = onCode || onScan || null;
  }, [onCode, onScan]);

  const [cameraError, setCameraError] = useState(null);
  const [manualValue, setManualValue] = useState("");

  // Hold IDs separately so stop() truly cancels everything
  const rafIdRef = useRef(null);
  const timeoutIdRef = useRef(null);

  useEffect(() => {
    let stream = null;
    let stopped = false;
    let isMounted = true;

    async function start() {
      if (!active || !isMounted) return;
      if (typeof window === "undefined" || typeof navigator === "undefined") return;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!isMounted) return;
        setCameraError(
          "This device does not support camera access in the browser. Please type the code instead."
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
        if (!isMounted) return;
        setCameraError(
          "We couldn't access the camera. Check permissions and try again, or type the code instead."
        );
        return;
      }

      if (!isMounted || !active) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        return;
      }

      const video = videoRef.current;
      if (!video) {
        console.warn("[QrScanner] videoRef missing after getUserMedia (component changed)");
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsInline", "true");

      // Wait for metadata so videoWidth/Height exist
      await new Promise((resolve) => {
        const handleLoaded = () => {
          video.removeEventListener("loadedmetadata", handleLoaded);
          resolve();
        };
        if (video.readyState >= 1) resolve();
        else video.addEventListener("loadedmetadata", handleLoaded);
      });

      try {
        const p = video.play();
        if (p && typeof p.then === "function") await p;
      } catch (err) {
        console.warn("[QrScanner] video.play() failed:", err);
      }

      const loop = () => {
        if (stopped || !isMounted) return;

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

            // ✅ Only stop if handler didn't explicitly return false
            if (accepted !== false) {
              stop();
              return;
            }
          }
        } catch (err) {
          console.warn("[QrScanner] jsQR detect error:", err);
          onError?.("There was a problem reading that code. Try holding it steady and closer.");
        }

        // ~10fps to keep CPU sane
        timeoutIdRef.current = window.setTimeout(() => {
          rafIdRef.current = requestAnimationFrame(loop);
        }, 100);
      };

      rafIdRef.current = requestAnimationFrame(loop);
    }

    function stop() {
      stopped = true;

      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }

    if (active) start();

    return () => {
      isMounted = false;
      stop();
    };
  }, [active, onError]); // ✅ IMPORTANT: do NOT depend on onScan/onCode

  if (!active) return null;

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
