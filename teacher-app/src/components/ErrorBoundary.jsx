// teacher-app/src/components/ErrorBoundary.jsx
// Catches any unhandled render/lifecycle error in its subtree and shows a
// friendly fallback instead of a white screen.
import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log to console so it still appears in Vercel / browser devtools
    console.error("[ErrorBoundary] Uncaught render error:", error, info?.componentStack);
  }

  handleReload() {
    // Clear state and try re-rendering; full reload as last resort
    this.setState({ error: null });
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || String(this.state.error);

    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          background: "#f8fafc",
          color: "#1e293b",
          textAlign: "center",
          gap: "1rem",
        }}
      >
        <div style={{ fontSize: "3rem" }}>⚠️</div>
        <h2 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>
          Something went wrong
        </h2>
        <p style={{ margin: 0, color: "#64748b", maxWidth: 420 }}>
          The app hit an unexpected error. Reloading usually fixes it.
        </p>
        <details
          style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            color: "#94a3b8",
            maxWidth: 520,
            wordBreak: "break-word",
          }}
        >
          <summary style={{ cursor: "pointer" }}>Error details</summary>
          <pre style={{ textAlign: "left", marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
            {msg}
          </pre>
        </details>
        <button
          onClick={() => this.handleReload()}
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 1.4rem",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            fontSize: "1rem",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Reload page
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
