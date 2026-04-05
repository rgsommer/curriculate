"use client";

import { useState, useRef, useEffect } from "react";
import type { CSSProperties } from "react";

const STUDENT_APP_DEMO_URL =
  process.env.NEXT_PUBLIC_STUDENT_APP_URL?.replace(/\/$/, "") ||
  "https://play.curriculate.net";

export default function DemoPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Listen for messages from the embedded demo (e.g., task selection, score updates)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Only accept messages from our student app origin
      try {
        const url = new URL(STUDENT_APP_DEMO_URL);
        if (e.origin !== url.origin) return;
      } catch {
        return;
      }

      const data = e.data;
      if (!data || typeof data !== "object") return;

      // Future: handle demo events like task completion, score changes, etc.
      if (data.type === "demo:taskSelected") {
        // Could update parent UI with current task info
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const toggleFullscreen = () => setFullscreen((prev) => !prev);

  return (
    <div style={fullscreen ? styles.pageFullscreen : styles.page}>
      {/* Header (hidden in fullscreen) */}
      {!fullscreen && (
        <div style={styles.header}>
          <div style={styles.headerTop}>
            <div>
              <h1 style={styles.h1}>Curriculate Demo</h1>
              <p style={styles.sub}>
                Try the actual student experience. Pick a task type, interact with it,
                and see how scoring works in real time.
              </p>
            </div>
            <div style={styles.actions}>
              <a href="https://www.curriculate.net" style={styles.secondaryBtn}>
                Back to Home
              </a>
              <button onClick={toggleFullscreen} style={styles.primaryBtn}>
                Fullscreen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen exit button */}
      {fullscreen && (
        <button onClick={toggleFullscreen} style={styles.exitFullscreen}>
          Exit Fullscreen
        </button>
      )}

      {/* Loading indicator */}
      {!loaded && (
        <div style={styles.loadingCard}>
          <div style={styles.spinner} />
          <div style={{ fontWeight: 700, marginTop: 12 }}>Loading interactive demo...</div>
          <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
            This loads the actual student app experience
          </div>
        </div>
      )}

      {/* Iframe embed of the student-app demo */}
      <div style={fullscreen ? styles.iframeWrapperFullscreen : styles.iframeWrapper}>
        <iframe
          ref={iframeRef}
          src={`${STUDENT_APP_DEMO_URL}/demo`}
          title="Curriculate Interactive Demo"
          style={{
            ...styles.iframe,
            opacity: loaded ? 1 : 0,
          }}
          onLoad={() => setLoaded(true)}
          allow="camera; microphone; autoplay"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: 18,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    minHeight: "100vh",
  },
  pageFullscreen: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "#0f172a",
  },
  header: {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 16,
    padding: 16,
    background: "#fff",
    marginBottom: 14,
  },
  headerTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  h1: { margin: "2px 0 8px", fontSize: 28, letterSpacing: -0.4 },
  sub: { margin: 0, opacity: 0.82, lineHeight: 1.5, maxWidth: 600 },
  actions: { display: "flex", gap: 10, flexWrap: "wrap" as const, alignItems: "center" },
  primaryBtn: {
    padding: "10px 16px",
    borderRadius: 12,
    background: "#111",
    color: "#fff",
    fontWeight: 850,
    border: "1px solid rgba(0,0,0,0.2)",
    cursor: "pointer",
    fontSize: 14,
  },
  secondaryBtn: {
    padding: "10px 16px",
    borderRadius: 12,
    background: "#fff",
    color: "#111",
    textDecoration: "none",
    fontWeight: 850,
    border: "1px solid rgba(0,0,0,0.2)",
    fontSize: 14,
  },
  exitFullscreen: {
    position: "fixed" as const,
    top: 12,
    right: 12,
    zIndex: 10000,
    padding: "8px 14px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(0,0,0,0.2)",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
  },
  loadingCard: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 16,
    background: "#fff",
    textAlign: "center" as const,
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid rgba(0,0,0,0.1)",
    borderTopColor: "#3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  iframeWrapper: {
    borderRadius: 16,
    overflow: "hidden",
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#0f172a",
    boxShadow: "0 18px 60px rgba(15, 23, 42, 0.12)",
  },
  iframeWrapperFullscreen: {
    position: "absolute" as const,
    inset: 0,
  },
  iframe: {
    display: "block",
    width: "100%",
    height: "calc(100vh - 180px)",
    minHeight: 600,
    border: "none",
    transition: "opacity 0.3s ease",
  },
};
