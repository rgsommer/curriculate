// student-app/src/components/QrScanner.jsx
import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

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

  const [cameraError, setCameraError] = useState(null);
  const [manualValue, setManualValue] = useState("");

  useEffect(() => {
    let stream = null;
    let animationId = null;
    let stopped = false;
    let isMounted = true;

    async function start() {
      if (!active || !isMounted) return;
      if (typeof window === "undefined" || typeof navigator === "undefined") {
        return;
      }

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
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
        return;
      }

      const video = videoRef.current;
      if (!video) {
        console.warn("[QrScanner] videoRef missing after getUserMedia (component changed)");
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsInline", "true");

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

      const loop = async () => {
        if (stopped || !isMounted) return;

        const v = videoRef.current;
        const c = canvasRef.current;
        if (!v || !c) {
          animationId = requestAnimationFrame(loop);
          return;
        }

        const ctx = c.getContext("2d");
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
          const imageData = ctx.getImageData(0, 0, c.width, c.height);
          const qr = jsQR(imageData.data, c.width, c.height);

          if (qr && qr.data) {
            const rawValue = qr.data;
            console.log("[QrScanner] jsQR detected:", rawValue);
            const accepted = onCode ? onCode(rawValue) : true;
            if (accepted !== false) {
              stop();
              return;
            }
          }
        } catch (err) {
          console.warn("[QrScanner] jsQR detect error:", err);
          onError &&
            onError(
              "There was a problem reading that code. Try holding it steady and closer."
            );
        }

        // To avoid pegging the CPU, run at ~10 fps instead of every repaint
        animationId = window.setTimeout(() => {
          requestAnimationFrame(loop);
        }, 100);
      };

      animationId = requestAnimationFrame(loop);
    }

    function stop() {
      stopped = true;
      if (animationId) {
        // animationId can be from setTimeout wrapper or requestAnimationFrame.
        // clear both just to be safe.
        try {
          cancelAnimationFrame(animationId);
        } catch (e) {
          clearTimeout(animationId);
        }
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
      isMounted = false;
      stop();
    };
  }, [active, onCode, onError]);

  // If not active, render nothing
  if (!active) {
    return null;
  }

  const showManualOnly = !!cameraError;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
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
      )}

      {showManualOnly && (
        <>
          {cameraError && (
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "#b91c1c",
              }}
            >
              {cameraError}
            </p>
          )}
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
